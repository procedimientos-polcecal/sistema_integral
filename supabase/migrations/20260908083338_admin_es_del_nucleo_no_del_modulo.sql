-- ============================================================
-- SdG — Admin es del nucleo no del modulo
--
-- POR QUÉ. `es_admin()` (002) dice `rol in ('admin_sistema', 'admin')`, y
-- todas las `tiene_acceso_<modulo>()` / `puede_editar_<modulo>()` /
-- `es_admin_<modulo>()` empiezan con `es_admin() or ...`. Así que en la base
-- un usuario con `rol = 'admin'` pasa RLS en cualquier módulo sin necesitar un
-- grant en `usuario_modulos`.
--
-- Pero `nivelEnModulo()` (lib/core/access.ts) sólo hace ese bypass para
-- `rol === "admin_sistema"`. El comentario de la propia migración de
-- Producción (20260907154336) lo dice de manera explícita: "Las tres tienen
-- que decir lo mismo que lib/produccion/auth.ts" — y `lib/produccion/auth.ts`
-- pasa por `nivelEnModulo()`, que no incluye a `admin`. No coinciden.
--
-- La app ya trata a `admin` como administrador del **núcleo**, no de cada
-- módulo: `lib/core/route-utils.ts` (`es_admin_check`) dice en su comentario
-- "a nivel núcleo, no de módulo", y las pantallas de administración
-- (`/administracion/usuarios`, `/administracion/empresas`) muestran
-- `esAdmin = rol === "admin_sistema" || rol === "admin"` para gestionar
-- usuarios, empresas y sectores — no para operar dentro de Mantenimiento,
-- RRHH, Compras, Inventario o Producción.
--
-- La realidad de la base confirma la lectura: el único usuario con
-- `rol = 'admin'` hoy (soporte.mantenimiento@polcecal.com) tiene grants
-- explícitos en `usuario_modulos` — admin en mantenimiento, lectura en
-- remises/inventario/produccion, nada en rrhh ni compras — igual que
-- cualquier encargado u operario. Si `admin` bypasseara módulos por rol, esos
-- grants explícitos no harían falta. Hoy ese usuario no ve rrhh ni compras en
-- el menú (nivelEnModulo lo bloquea, correcto), pero por este bug SÍ podría
-- leer y escribir esas tablas pasando por alto RLS si algo golpeara la API
-- directamente — un admin de soporte de Mantenimiento con acceso de hecho a
-- nóminas y compras que nadie le concedió.
--
-- QUÉ NO CAMBIA. `es_admin()` sigue significando "admin_sistema o admin" para
-- las policies que ya son del núcleo por diseño propio (ver sus comentarios):
--   - 002_nucleo_rls.sql: empresas, sectores, usuarios, usuario_modulos,
--     empleados — la misma pantalla de administración.
--   - proveedores (20260903091434): catálogo del núcleo, igual que empleados.
--   - compras_odoo_ordenes (20260904084145): dice "admin del núcleo" en su
--     propio comentario.
--   - usuario_areas_compras (20260904103615): dice "el administrador del
--     sistema, en la misma pantalla donde ya carga los permisos de módulo".
-- Esas tablas son configuración transversal, no datos de un módulo — ahí
-- `admin` sí debe poder escribir sin necesitar un grant.
--
-- QUÉ CAMBIA. Las funciones de acceso **de módulo** —tiene_acceso_<modulo>(),
-- puede_editar_<modulo>(), es_admin_<modulo>()— pasan de `es_admin()` a un
-- nuevo `es_admin_sistema()` que sólo mira `admin_sistema`. Es exactamente lo
-- que ya hace `nivelEnModulo()` del lado del código, y es lo que la 029 ya
-- decidió para `mant_nivel()` cuando apareció esta misma familia de bug al
-- revés (admin_sistema sin grant veía botones y RLS le vaciaba las listas).
--
-- NO TOCA `es_admin()`: sigue usándose tal cual en el núcleo y en
-- `puede_aprobar_compras()`/`os_aprobadores` ya excluyen a admin a propósito
-- desde la 020/028 (aprobar es autorizar plata, no administrar).
-- ============================================================

-- ── El helper nuevo: sólo admin_sistema, el admin de TODO el sistema ────────
create or replace function public.es_admin_sistema()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select rol = 'admin_sistema' from usuarios where id = auth.uid()),
    false
  )
$$;

comment on function public.es_admin_sistema() is
  'Sólo admin_sistema. Espejo de "rol === admin_sistema" en nivelEnModulo() '
  '(lib/core/access.ts) — a diferencia de es_admin(), NO incluye a admin: '
  'admin administra el núcleo (usuarios, empresas, sectores), no bypassa el '
  'acceso a un módulo que no le fue concedido en usuario_modulos.';

-- ── Mantenimiento (004) ──────────────────────────────────────
create or replace function public.puede_editar_mantenimiento()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'mantenimiento'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

create or replace function public.tiene_acceso_mantenimiento()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'mantenimiento'
    ),
    false
  )
$$;

-- ── RRHH (009) ───────────────────────────────────────────────
create or replace function public.puede_editar_rrhh()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'rrhh' and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

create or replace function public.es_admin_rrhh()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'rrhh' and nivel = 'admin'
    ),
    false
  )
$$;

create or replace function public.tiene_acceso_rrhh()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'rrhh'
    ),
    false
  )
$$;

-- ── Remises (013) ────────────────────────────────────────────
create or replace function public.puede_editar_remises()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'remises' and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

create or replace function public.es_admin_remises()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'remises' and nivel = 'admin'
    ),
    false
  )
$$;

create or replace function public.tiene_acceso_remises()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'remises'
    ),
    false
  )
$$;

-- ── Compras (016) ────────────────────────────────────────────
-- No se toca puede_aprobar_compras(): la 028 ya la reescribió sin es_admin()
-- a propósito ("administrar y aprobar son cosas separadas"), así que ni
-- siquiera pasaba por acá.
create or replace function public.puede_editar_compras()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'compras'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

create or replace function public.tiene_acceso_compras()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'compras'
    ),
    false
  )
$$;

-- ── Inventario (046) ─────────────────────────────────────────
create or replace function public.tiene_acceso_inventario()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'inventario'
    ),
    false
  )
$$;

create or replace function public.puede_editar_inventario()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'inventario'
        and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

create or replace function public.es_admin_inventario()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'inventario'
        and nivel = 'admin'
    ),
    false
  )
$$;

-- ── Producción (20260907154336) ──────────────────────────────
create or replace function public.tiene_acceso_produccion()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin_sistema() or exists (
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
    es_admin_sistema() or exists (
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
    es_admin_sistema() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid()
        and modulo = 'produccion'
        and nivel = 'admin'
    ),
    false
  )
$$;
