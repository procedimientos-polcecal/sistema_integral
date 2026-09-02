-- ============================================================
-- SdG — El módulo Inventario: permisos, tablas, RPC y RLS
--
-- Porta `procedimientos-polcecal/inventario` (Next.js + Neon + Auth.js) contra
-- las tablas que este ERP ya tiene. De sus siete tablas, cinco no se portan
-- porque ya existen: `usuarios`, `sectores`, `equipos`, `empleados` y
-- `proveedores`. Su login propio con bcrypt lo reemplaza el del SdG.
--
-- Requiere que la 045 ya haya corrido y commiteado: las funciones de abajo
-- mencionan 'inventario' en su cuerpo y Postgres lo valida al crearlas.
--
-- LA PLANILLA MANDA. La gente del pañol sigue cargando movimientos en
-- `GESTIÓN DE ALMACÉN POLCECAL POLYSAN` —la misma que Mantenimiento consulta
-- para saber si hay un repuesto—, así que el kardex es la unión de lo que carga
-- la app y lo que carga la gente, y la fórmula del listado es el stock
-- consolidado correcto. El SdG no calcula el stock: lo lee y anota cuándo.
-- ============================================================

-- ── 1. Permisos ──────────────────────────────────────────────
-- Los tres roles del repo de origen mapean uno a uno con los niveles del SdG:
-- consulta→lectura, operador→edicion, admin→admin. Calcadas de las de Compras.

-- ¿Tiene acceso al módulo, en cualquier nivel?
create or replace function public.tiene_acceso_inventario()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'inventario'
    ),
    false
  )
$$;

-- ¿Puede registrar movimientos? Es el `operador` del repo de origen.
create or replace function public.puede_editar_inventario()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'inventario'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

-- ¿Puede dar de alta y editar artículos? Es el ABM del catálogo.
create or replace function public.es_admin_inventario()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'inventario'
        and nivel = 'admin'
    ),
    false
  )
$$;

-- ── 2. El catálogo de artículos ──────────────────────────────

create table if not exists inventario_articulos (
  id               uuid primary key default gen_random_uuid(),
  -- El código de la planilla, con ceros a la izquierda ("00469"). Es texto y no
  -- número: es lo que se escanea el día que haya lector de códigos, y un cero
  -- perdido lo vuelve otro artículo.
  codigo           text not null unique,
  descripcion      text not null,
  ubicacion        text,
  proveedores_ref  text,
  marcas           text,

  stock_inicial    numeric not null default 0,
  -- Lo que dijo la planilla la última vez que se la leyó. No lo calcula el SdG:
  -- la fórmula del listado suma el kardex entero, incluido lo que se carga a
  -- mano, y eso es el stock de verdad.
  stock_actual     numeric not null default 0,
  stock_seguridad  numeric not null default 0,
  faltante         numeric generated always as
                   (greatest(stock_seguridad - stock_actual, 0)) stored,

  -- Cuándo se leyó ese stock. Un número sin fecha se lee como si fuera de
  -- ahora, y acá puede tener horas.
  stock_sincronizado_en timestamptz,
  sheets_fila      integer,

  activo           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists inventario_articulos_descripcion_idx
  on inventario_articulos (descripcion);
create index if not exists inventario_articulos_activo_idx
  on inventario_articulos (activo) where activo;
-- Los faltantes son la consulta que más se hace y la que ordena el trabajo.
create index if not exists inventario_articulos_faltante_idx
  on inventario_articulos (faltante) where faltante > 0;

create trigger inventario_articulos_updated_at
  before update on inventario_articulos
  for each row execute function set_updated_at();

comment on column inventario_articulos.stock_actual is
  'Lo que dijo la planilla la última vez que se sincronizó, no un cálculo del SdG. Ver stock_sincronizado_en.';
comment on column inventario_articulos.faltante is
  'Cuánto falta para llegar al stock de seguridad. Generada: no se escribe.';

-- ── 3. El kardex ─────────────────────────────────────────────
--
-- Append-only. Cada movimiento apunta al núcleo y **conserva al lado el texto
-- crudo de la planilla**: es el mismo criterio de equipo_raw/equipment_id y
-- contratista/proveedor_id en Mantenimiento. El enlace se completa cuando se
-- reconoce a quién nombra; lo que no se reconoce queda en null y se informa,
-- porque enlazarlo al que se le parece es peor que dejarlo vacío (migración 032).

create table if not exists inventario_movimientos (
  id               uuid primary key default gen_random_uuid(),
  articulo_id      uuid not null references inventario_articulos(id) on delete restrict,
  -- El código se repite acá a propósito: la planilla lo trae en cada fila y es
  -- lo que permite leer el kardex sin resolver el artículo.
  codigo           text,

  fecha            timestamptz not null default now(),
  tipo             text not null check (tipo in ('entrada', 'salida', 'ajuste')),
  cantidad         numeric not null,
  stock_anterior   numeric,
  stock_resultante numeric,

  -- Quién lo pidió. El nombre como lo escribió la planilla, y el empleado del
  -- núcleo cuando se lo reconoce.
  solicitante      text,
  empleado_id      uuid references empleados(id) on delete set null,

  sector_raw       text,
  sector_id        uuid references sectores(id) on delete set null,
  equipo_raw       text,
  equipment_id     uuid references equipos(id) on delete set null,
  proveedor_raw    text,
  proveedor_id     uuid references proveedores(id) on delete set null,

  -- El N° de requerimiento que la planilla trae en su columna A. Es el gancho
  -- con Compras y queda listo sin usarse todavía: el enlace a
  -- compras_requerimientos es de otro spec.
  ri               integer,

  creado_por       uuid references usuarios(id) on delete set null,
  -- De dónde vino. Sin esto la sincronización no sabe qué le toca reescribir.
  origen           text not null default 'app' check (origen in ('app', 'planilla')),
  sheets_fila      integer,
  created_at       timestamptz not null default now(),

  constraint inventario_cantidad_valida check (
    (tipo in ('entrada', 'salida') and cantidad > 0) or
    (tipo = 'ajuste' and cantidad >= 0)
  )
);

create index if not exists inventario_mov_articulo_idx on inventario_movimientos (articulo_id);
create index if not exists inventario_mov_fecha_idx    on inventario_movimientos (fecha desc);
create index if not exists inventario_mov_sector_idx   on inventario_movimientos (sector_id);
create index if not exists inventario_mov_ri_idx       on inventario_movimientos (ri) where ri is not null;

-- Una fila de la planilla es un movimiento y uno solo. Es lo que hace que
-- reimportar no duplique, y lo que la sincronización usa para reconocerlos.
create unique index if not exists inventario_mov_sheets_fila_idx
  on inventario_movimientos (sheets_fila) where sheets_fila is not null;

comment on column inventario_movimientos.origen is
  'app = lo cargó alguien en el SdG. planilla = vino del kardex de Google Sheets.';
comment on column inventario_movimientos.ri is
  'N° de requerimiento de Compras, tal como lo trae la planilla. Todavía sin enlazar a compras_requerimientos.';

-- ── 4. Registrar un movimiento, sin que dos se pisen ─────────
--
-- Portado del repo de origen con ids uuid. El bloqueo de fila sigue sirviendo
-- aunque la planilla mande: evita que dos salidas simultáneas *desde la app* se
-- pisen entre sí en el rato que pasa hasta la próxima sincronización.
--
-- El stock que deja acá es provisorio y la planilla lo corrige. Está bien que
-- así sea: quien carga una salida desde el celular necesita ver el efecto ahora,
-- no dentro de quince minutos.

create or replace function public.inventario_registrar_movimiento(
  p_articulo_id  uuid,
  p_tipo         text,
  p_cantidad     numeric,
  p_creado_por   uuid,
  p_solicitante  text default null,
  p_sector_id    uuid default null,
  p_equipment_id uuid default null,
  p_proveedor_id uuid default null,
  p_empleado_id  uuid default null,
  p_ri           integer default null
)
returns inventario_movimientos
language plpgsql security definer set search_path = public
as $$
declare
  v_stock_ant numeric;
  v_stock_new numeric;
  v_codigo    text;
  v_mov       inventario_movimientos;
begin
  if not puede_editar_inventario() then
    raise exception 'Registrar movimientos requiere nivel de edición en Inventario';
  end if;

  if p_tipo not in ('entrada', 'salida', 'ajuste') then
    raise exception 'Tipo de movimiento inválido: %', p_tipo;
  end if;
  if p_tipo in ('entrada', 'salida') and p_cantidad <= 0 then
    raise exception 'La cantidad debe ser mayor a 0';
  end if;
  if p_tipo = 'ajuste' and p_cantidad < 0 then
    raise exception 'El ajuste no puede ser negativo';
  end if;

  -- Bloqueo de la fila del artículo → concurrencia segura.
  select stock_actual, codigo into v_stock_ant, v_codigo
    from inventario_articulos where id = p_articulo_id
    for update;
  if not found then
    raise exception 'Artículo % inexistente', p_articulo_id;
  end if;

  v_stock_new := case p_tipo
    when 'entrada' then v_stock_ant + p_cantidad
    when 'salida'  then v_stock_ant - p_cantidad
    when 'ajuste'  then p_cantidad
  end;

  update inventario_articulos
     set stock_actual = v_stock_new
   where id = p_articulo_id;

  insert into inventario_movimientos (
    articulo_id, codigo, tipo, cantidad, stock_anterior, stock_resultante,
    solicitante, empleado_id, sector_id, equipment_id, proveedor_id, ri,
    creado_por, origen
  ) values (
    p_articulo_id, v_codigo, p_tipo, p_cantidad, v_stock_ant, v_stock_new,
    p_solicitante, p_empleado_id, p_sector_id, p_equipment_id, p_proveedor_id, p_ri,
    p_creado_por, 'app'
  )
  returning * into v_mov;

  return v_mov;
end;
$$;

-- ── 5. RLS ───────────────────────────────────────────────────
--
-- Leer con acceso al módulo. Los movimientos no se editan ni se borran: un
-- kardex que se puede reescribir no es un kardex. Un error se corrige con un
-- ajuste, que es como se hace en el pañol.

alter table inventario_articulos   enable row level security;
alter table inventario_movimientos enable row level security;

drop policy if exists inventario_articulos_select on inventario_articulos;
create policy inventario_articulos_select on inventario_articulos
  for select to authenticated using (tiene_acceso_inventario());

drop policy if exists inventario_articulos_write on inventario_articulos;
create policy inventario_articulos_write on inventario_articulos
  for all to authenticated
  using (es_admin_inventario())
  with check (es_admin_inventario());

drop policy if exists inventario_mov_select on inventario_movimientos;
create policy inventario_mov_select on inventario_movimientos
  for select to authenticated using (tiene_acceso_inventario());

-- El insert va por el RPC, que es `security definer` y valida el permiso él
-- mismo. Esta policy es para que la ruta pueda insertar sin el cliente admin.
drop policy if exists inventario_mov_insert on inventario_movimientos;
create policy inventario_mov_insert on inventario_movimientos
  for insert to authenticated
  with check (puede_editar_inventario());
