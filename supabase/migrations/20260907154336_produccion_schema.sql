-- ============================================================
-- SdG — Producción: tipos, tablas, permisos y RLS
--
-- Requiere que la migración del enum ya haya corrido y commiteado.
--
-- Es el primer módulo del SdG que no porta una app: modela el formulario 040/2
-- "INFORME DE FÁBRICA" en papel, uno por turno. Ver
-- docs/superpowers/specs/2026-09-07-produccion-design.md.
--
-- LA PRODUCCIÓN NO SE GUARDA. Se despeja al leer:
--   producción = depósito - depósito anterior + despachado + rotura
-- El "depósito anterior" sale del parte anterior en orden cronológico. Guardarlo
-- es exactamente el error del Excel que este módulo reemplaza: allá vive en una
-- columna oculta única por producto, que el Apps Script pisa al guardar, y que
-- se desincroniza sin que nada avise.
-- ============================================================

-- ── 1. Tipos ─────────────────────────────────────────────────

-- Con las horas adentro del nombre: dice solo que faltan ocho horas sin
-- registrar. El turno de noche, el día que exista, es un valor más.
create type produccion_turno   as enum ('4_12', '12_20');
create type produccion_familia as enum ('filler', '0_2', 'cal', 'otros');
create type produccion_envase  as enum ('bolsa', 'bolson');

-- ── 2. Permisos ──────────────────────────────────────────────
-- Calcadas de las de Inventario (046). Las tres tienen que decir lo mismo que
-- lib/produccion/auth.ts: cuando no coincidieron, en la 029, un admin_sistema
-- veía los botones y RLS le devolvía listas vacías.

create or replace function public.tiene_acceso_produccion()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'produccion'
    ),
    false
  )
$$;

create or replace function public.puede_editar_produccion()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'produccion'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

create or replace function public.es_admin_produccion()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'produccion'
        and nivel = 'admin'
    ),
    false
  )
$$;

-- ── 3. El catálogo de productos ──────────────────────────────
-- Tabla y no columnas clavadas: en el Excel los 17 productos están como filas
-- en una hoja, como columnas en otras cuatro y como rangos en el script, así que
-- agregar uno es tocar todo.

create table if not exists produccion_productos (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  familia         produccion_familia not null,
  envase          produccion_envase  not null,
  -- La bolsa son 25 kg. El bolsón está sin confirmar, por eso admite null: un
  -- número inventado acá haría fallar la comprobación de kilos contra bultos en
  -- todos los renglones y se terminaría apagando la comprobación.
  kg_por_unidad   numeric,
  -- Cómo se llama su columna en los resúmenes de la planilla. Null = no se
  -- exporta, y eso es una decisión válida, no un dato faltante.
  nombre_planilla text,
  orden           int not null,
  activo          boolean not null default true
);

create unique index if not exists produccion_productos_nombre_idx
  on produccion_productos (lower(nombre));

-- ── 4. El parte de turno ─────────────────────────────────────

create table if not exists produccion_partes (
  id                  uuid primary key default gen_random_uuid(),
  fecha               date not null,
  turno               produccion_turno not null,

  -- El capataz firma el papel. Se guarda lo que dice el papel y, aparte, el
  -- enlace al empleado sólo cuando se lo reconoce con certeza. Enlazar al que se
  -- le parece es peor que dejar en null: el dato aparece en el lugar que no es.
  capataz_raw         text,
  -- set null y no restrict: el parte es un documento histórico y perder quién
  -- lo firmó es preferible a impedir dar de baja a un empleado que ya no está.
  capataz_id          uuid references empleados(id) on delete set null,

  observaciones       text,
  tareas_limpieza     text,
  recuento_bolsones   text,

  cargado_por         uuid not null references usuarios(id),
  cargado_en          timestamptz not null default now(),
  actualizado_por     uuid references usuarios(id),
  actualizado_en      timestamptz,

  -- Por qué no se pudo escribir en la planilla, con lo que dijo Google sin
  -- traducir. Null = está escrito.
  sheets_pendiente    text,
  sheets_pendiente_en timestamptz,

  -- Constraint completa y no índice parcial: es el destino del ON CONFLICT del
  -- upsert. Un índice parcial no sirve para eso — trampa #2 del README.
  unique (fecha, turno)
);

create index if not exists produccion_partes_fecha_idx
  on produccion_partes (fecha desc);

create index if not exists produccion_partes_pendiente_idx
  on produccion_partes (sheets_pendiente_en)
  where sheets_pendiente is not null;

create table if not exists produccion_deposito (
  parte_id    uuid not null references produccion_partes(id) on delete cascade,
  producto_id uuid not null references produccion_productos(id),
  cantidad    numeric not null,
  primary key (parte_id, producto_id)
);

create table if not exists produccion_despachos (
  id               uuid primary key default gen_random_uuid(),
  parte_id         uuid not null references produccion_partes(id) on delete cascade,
  orden            int not null,

  equipo_raw       text,
  -- No hay catálogo de clientes en el núcleo: va a ser del módulo Despacho.
  cliente_raw      text,

  -- Puede ser null con el texto crudo al lado: el papel tiene un renglón
  -- "Otros" y nombres escritos a mano que no siempre se reconocen.
  producto_id      uuid references produccion_productos(id),
  producto_raw     text,

  kilos            numeric,
  bultos           numeric,
  envase_raw       text,
  pallets_cantidad numeric,
  pallets_tipo     text,

  -- Separadas como en el papel: la rotura pasa al cargar el camión.
  rotura_bolsa     numeric not null default 0,
  rotura_bolson    numeric not null default 0
);

create index if not exists produccion_despachos_parte_idx
  on produccion_despachos (parte_id);

-- ── 5. RLS ───────────────────────────────────────────────────

alter table produccion_productos enable row level security;
alter table produccion_partes    enable row level security;
alter table produccion_deposito  enable row level security;
alter table produccion_despachos enable row level security;

drop policy if exists produccion_productos_select on produccion_productos;
create policy produccion_productos_select on produccion_productos
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_productos_write on produccion_productos;
create policy produccion_productos_write on produccion_productos
  for all to authenticated
  using (es_admin_produccion())
  with check (es_admin_produccion());

drop policy if exists produccion_partes_select on produccion_partes;
create policy produccion_partes_select on produccion_partes
  for select to authenticated using (tiene_acceso_produccion());

-- Los partes sí se corrigen, a diferencia del kardex de Inventario: el papel se
-- transcribe y transcribir se equivoca. Queda el rastro de quién y cuándo.
drop policy if exists produccion_partes_write on produccion_partes;
create policy produccion_partes_write on produccion_partes
  for all to authenticated
  using (puede_editar_produccion())
  with check (puede_editar_produccion());

drop policy if exists produccion_deposito_select on produccion_deposito;
create policy produccion_deposito_select on produccion_deposito
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_deposito_write on produccion_deposito;
create policy produccion_deposito_write on produccion_deposito
  for all to authenticated
  using (puede_editar_produccion())
  with check (puede_editar_produccion());

drop policy if exists produccion_despachos_select on produccion_despachos;
create policy produccion_despachos_select on produccion_despachos
  for select to authenticated using (tiene_acceso_produccion());

drop policy if exists produccion_despachos_write on produccion_despachos;
create policy produccion_despachos_write on produccion_despachos
  for all to authenticated
  using (puede_editar_produccion())
  with check (puede_editar_produccion());

comment on table produccion_partes is
  'Un parte por turno, que es un papel 040/2. La producción no está acá: se despeja contra el depósito del parte anterior.';

comment on column produccion_deposito.cantidad is
  'Lo que muestra el depósito al cerrar ese turno: una foto, no un acumulado ni un movimiento.';
comment on column produccion_partes.capataz_raw is
  'Lo que dice el papel, siempre. capataz_id sólo se llena cuando el nombre identifica a un empleado con certeza.';
comment on column produccion_partes.sheets_pendiente is
  'Por qué no se pudo escribir en la planilla, con lo que dijo Google sin traducir. Null = está escrito.';
comment on column produccion_productos.nombre_planilla is
  'Cómo se llama la columna del producto en los resúmenes de la planilla. Null significa que no se exporta, una decisión y no un dato faltante.';
comment on column produccion_despachos.producto_id is
  'Puede ser null con producto_raw al lado: el papel tiene un renglón "Otros" y nombres escritos a mano. Enlazar al que se le parece pone la producción de un producto en la columna de otro y no se nota nunca.';
