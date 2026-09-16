-- ============================================================
-- SdG — Envases: el stock de envases que lleva calidad
--
-- Sección de Producción, no módulo nuevo: usa tiene_acceso_produccion(),
-- puede_editar_produccion() y es_admin_produccion(), que ya existen. Por eso
-- no hay valor de enum nuevo y esto entra en un solo archivo.
--
-- LA PLANILLA MANDA, al revés que el resto de Producción. Su planilla es la
-- del almacén clonada: el stock del listado es una fórmula
-- (inicial + Σ entradas − Σ salidas) sobre el kardex, así que es el stock
-- consolidado correcto y el SdG lo LEE en vez de calcularlo.
-- Ver docs/superpowers/specs/2026-09-15-produccion-envases-design.md
-- ============================================================

-- ── 1. El catálogo ───────────────────────────────────────────

create table if not exists produccion_envases_articulos (
  id               uuid primary key default gen_random_uuid(),
  -- Con los ceros a la izquierda ("00001"). Texto y no número: un cero perdido
  -- lo vuelve otro artículo.
  codigo           text not null unique,
  descripcion      text not null,
  ubicacion        text,
  proveedores_ref  text,

  -- Lo que dice la columna K del kardex, que es con lo que la planilla agrupa
  -- bien. Null cuando el artículo no tiene movimientos —la K sale del kardex—
  -- o cuando sus filas dicen dos grupos distintos. Se informa, no se adivina.
  grupo            text,

  stock_inicial    numeric not null default 0,
  -- Lo que dijo la columna de fórmula la última vez que se la leyó. No es un
  -- cálculo del SdG. Ver stock_sincronizado_en: un número sin fecha se lee
  -- como si fuera de ahora.
  stock_actual     numeric not null default 0,
  stock_seguridad  numeric not null default 0,
  faltante         numeric generated always as
                   (greatest(stock_seguridad - stock_actual, 0)) stored,

  stock_sincronizado_en timestamptz,
  sheets_fila      integer,

  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists produccion_envases_articulos_grupo_idx
  on produccion_envases_articulos (grupo);
create index if not exists produccion_envases_articulos_faltante_idx
  on produccion_envases_articulos (faltante) where faltante > 0;

create trigger produccion_envases_articulos_updated_at
  before update on produccion_envases_articulos
  for each row execute function set_updated_at();

comment on column produccion_envases_articulos.stock_actual is
  'Lo que dijo la planilla la última vez que se sincronizó, no un cálculo del SdG.';
comment on column produccion_envases_articulos.grupo is
  'El grupo de envase, de la columna K del kardex. Null cuando no se lo reconoce con certeza.';

-- ── 2. El kardex ─────────────────────────────────────────────
--
-- UN MOVIMIENTO NO ES tipo+cantidad, como en Inventario. Es una fila con
-- cuatro números: la planilla tiene 4 filas con entrada y salida a la vez, y
-- la rotura y el despacho conviven con la salida en la misma fila. Partirlas
-- daría varios movimientos por una fila de planilla y rompería el sheets_fila
-- único, que es lo que hace que reimportar no duplique.
--
-- ROTURA y DESPACHO se guardan y NO descuentan stock, igual que la planilla:
-- medido, en 950 de 1.309 filas SALIDAS ≠ DESPACHO + ROTURA. Son tres números
-- independientes. Si mañana se decide que la rotura descuenta, es una consulta
-- y no una migración: los cuatro están crudos.

create table if not exists produccion_envases_movimientos (
  id               uuid primary key default gen_random_uuid(),
  articulo_id      uuid not null references produccion_envases_articulos(id) on delete restrict,
  -- El código se repite acá a propósito: la planilla lo trae en cada fila y es
  -- lo que permite leer el kardex sin resolver el artículo.
  codigo           text,

  -- date y no timestamptz: es un día, no un instante. Es la corrección que
  -- Inventario ya tuvo que hacer (20260903081542).
  fecha            date,

  entrada          numeric not null default 0,
  salida           numeric not null default 0,
  rotura           numeric not null default 0,
  despacho         numeric not null default 0,

  observacion      text,
  proveedor_raw    text,
  proveedor_id     uuid references proveedores(id) on delete set null,

  creado_por       uuid references usuarios(id) on delete set null,
  -- De dónde vino. Sin esto la sincronización no sabe qué le toca reescribir.
  origen           text not null default 'planilla' check (origen in ('app', 'planilla')),
  sheets_fila      integer,
  -- Por qué no se pudo escribir en la planilla, con lo que dijo Google sin
  -- traducir. Null = está escrito.
  sheets_pendiente    text,
  sheets_pendiente_en timestamptz,
  created_at       timestamptz not null default now(),

  -- Ninguna de las 1.404 filas de la planilla tiene los cuatro en cero: esto
  -- no rechaza nada de lo que hay, y frena la fila empezada y no terminada.
  constraint produccion_envases_mov_algo_paso
    check (entrada + salida + rotura + despacho > 0),
  constraint produccion_envases_mov_no_negativos
    check (entrada >= 0 and salida >= 0 and rotura >= 0 and despacho >= 0)
);

create index if not exists produccion_envases_mov_articulo_idx
  on produccion_envases_movimientos (articulo_id);
create index if not exists produccion_envases_mov_fecha_idx
  on produccion_envases_movimientos (fecha desc);

-- Una fila de la planilla es un movimiento y uno solo: es lo que hace que
-- reimportar no duplique, y el destino del ON CONFLICT de la sincronización.
-- Índice único parcial: como destino de ON CONFLICT hay que nombrar la misma
-- condición (`where sheets_fila is not null`) en el upsert, o Postgres no lo
-- encuentra — trampa #2 del README de migraciones.
create unique index if not exists produccion_envases_mov_sheets_fila_idx
  on produccion_envases_movimientos (sheets_fila) where sheets_fila is not null;

create index if not exists produccion_envases_mov_pendiente_idx
  on produccion_envases_movimientos (sheets_pendiente_en)
  where sheets_pendiente is not null;

comment on column produccion_envases_movimientos.rotura is
  'Se guarda y NO descuenta stock, igual que la planilla. No se deriva de salida: medido, no cierra en 950 de 1.309 filas.';
comment on column produccion_envases_movimientos.origen is
  'app = lo cargó alguien en el SdG. planilla = vino del kardex de Google Sheets.';

-- ── 3. Los proveedores de envases ────────────────────────────
-- Tabla propia y no filas en `proveedores`: la pestaña trae qué envases provee
-- cada uno, que es un dato de este módulo. El enlace al catálogo del núcleo se
-- guarda al lado, y queda en null cuando no se lo reconoce con certeza.

create table if not exists produccion_envases_proveedores (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null unique,
  tipos           text,
  contacto_nombre text,
  contacto_tel    text,
  contacto_alt    text,
  direccion       text,
  notas           text,
  cuit            text,
  proveedor_id    uuid references proveedores(id) on delete set null,
  sheets_fila     integer,
  created_at      timestamptz not null default now()
);

comment on column produccion_envases_proveedores.proveedor_id is
  'El proveedor del núcleo, cuando el CUIT o el nombre lo identifican con certeza. Null si no: enlazar al que se le parece es peor que dejar vacío.';

-- ── 4. La referencia de color, y su historial ────────────────
--
-- La tabla de colores SIN su historial miente. Hoy dice "AMARILLO = RECYCLE
-- BAG" y es verdad; entre el 9 y el 10 de junio de 2026 no lo era, y desde el
-- 3 de julio el verde es de Bolsera y no de Recuperadora del Sur. Guardar sólo
-- la foto de hoy le atribuye un bolsón viejo al proveedor equivocado.

create table if not exists produccion_envases_referencias (
  id               uuid primary key default gen_random_uuid(),
  color            text not null unique,
  proveedor_nombre text,
  orden            integer not null default 0,
  sheets_fila      integer
);

create table if not exists produccion_envases_referencias_historial (
  id          uuid primary key default gen_random_uuid(),
  texto       text not null,
  sheets_fila integer unique
);

-- ── 5. RLS ───────────────────────────────────────────────────
--
-- Las tres funciones de Producción, que ya existen. Leer con acceso al módulo;
-- escribir con edición. El kardex no se edita ni se borra desde la app: un
-- error se corrige con otro movimiento, como en el pañol.

alter table produccion_envases_articulos              enable row level security;
alter table produccion_envases_movimientos            enable row level security;
alter table produccion_envases_proveedores            enable row level security;
alter table produccion_envases_referencias            enable row level security;
alter table produccion_envases_referencias_historial  enable row level security;

drop policy if exists produccion_envases_articulos_select on produccion_envases_articulos;
create policy produccion_envases_articulos_select on produccion_envases_articulos
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_envases_articulos_write on produccion_envases_articulos;
create policy produccion_envases_articulos_write on produccion_envases_articulos
  for all to authenticated
  using (es_admin_produccion()) with check (es_admin_produccion());

drop policy if exists produccion_envases_mov_select on produccion_envases_movimientos;
create policy produccion_envases_mov_select on produccion_envases_movimientos
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_envases_mov_insert on produccion_envases_movimientos;
create policy produccion_envases_mov_insert on produccion_envases_movimientos
  for insert to authenticated with check (puede_editar_produccion());

-- La ruta del alta actualiza sheets_pendiente sobre la fila que acaba de
-- insertar. Sin este update, un fallo de escritura en la planilla se perdería.
drop policy if exists produccion_envases_mov_update on produccion_envases_movimientos;
create policy produccion_envases_mov_update on produccion_envases_movimientos
  for update to authenticated
  using (puede_editar_produccion()) with check (puede_editar_produccion());

drop policy if exists produccion_envases_prov_select on produccion_envases_proveedores;
create policy produccion_envases_prov_select on produccion_envases_proveedores
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_envases_ref_select on produccion_envases_referencias;
create policy produccion_envases_ref_select on produccion_envases_referencias
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_envases_ref_hist_select on produccion_envases_referencias_historial;
create policy produccion_envases_ref_hist_select on produccion_envases_referencias_historial
  for select to authenticated using (tiene_acceso_produccion());
