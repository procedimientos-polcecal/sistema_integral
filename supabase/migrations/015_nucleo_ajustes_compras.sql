-- ============================================================
-- SdG — Ajustes al núcleo para admitir el módulo Compras
--
-- Va separado del esquema del módulo a propósito: Postgres no deja usar un
-- valor nuevo de enum en la misma transacción en que se lo agrega, así que
-- 'compras' se suma acá y recién se usa en 016.
-- ============================================================

-- Nuevo módulo del sistema.
alter type modulo add value if not exists 'compras';

-- ── Proveedores: padrón compartido ───────────────────────────
-- Vive en el núcleo y no dentro de Compras porque Mantenimiento ya venía
-- guardando el contratista de cada OT como texto libre. Un único padrón evita
-- que se armen dos listas paralelas que se desincronizan.
create table proveedores (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique,
  cuit       text,
  contacto   text,
  telefono   text,
  email      text,
  rubro      text,
  notas      text,
  -- Distingue a quién presta servicios (contratista de Mantenimiento) de quién
  -- provee materiales. Un mismo proveedor puede ser las dos cosas.
  es_contratista boolean not null default false,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index proveedores_nombre_idx on proveedores (nombre);
create index proveedores_activo_idx on proveedores (activo) where activo;

create trigger proveedores_updated_at
  before update on proveedores
  for each row execute function set_updated_at();

-- Mantenimiento: se le suma la referencia al padrón sin tocar el texto libre
-- que ya tiene cargado, igual que equipo_raw/equipment_id en esta misma tabla.
-- El texto sigue siendo la fuente para las OT viejas o con contratistas
-- ocasionales que no vale la pena dar de alta.
alter table ordenes_trabajo
  add column if not exists proveedor_id uuid references proveedores(id) on delete set null;

create index if not exists ordenes_trabajo_proveedor_idx on ordenes_trabajo (proveedor_id);

comment on column ordenes_trabajo.contratista is
  'Nombre del contratista como vino de la planilla. proveedor_id lo resuelve contra el padrón cuando se lo pudo identificar.';

-- ── Helpers de permisos del módulo Compras ───────────────────
-- Mismo patrón que puede_editar_mantenimiento() / tiene_acceso_mantenimiento().

-- ¿Puede gestionar la etapa de compra (proveedor, comparativa, costos, estados)?
create or replace function public.puede_editar_compras()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'compras'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

-- ¿Puede aprobar o denegar requerimientos? Es una decisión de gerencia, más
-- restrictiva que gestionar la compra: sólo nivel admin del módulo.
create or replace function public.puede_aprobar_compras()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'compras'
        and nivel = 'admin'
    ),
    false
  )
$$;

-- ¿Tiene acceso al módulo, en cualquier nivel?
create or replace function public.tiene_acceso_compras()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'compras'
    ),
    false
  )
$$;

-- ── Proveedores: RLS ─────────────────────────────────────────
-- Lectura abierta (Mantenimiento también los consulta); escritura para quien
-- gestiona compras.
alter table proveedores enable row level security;

create policy proveedores_select on proveedores
  for select to authenticated using (true);

create policy proveedores_write on proveedores
  for all to authenticated
  using (puede_editar_compras())
  with check (puede_editar_compras());
