-- ============================================================
-- SdG — Mantenimiento: cimientos de la integración
--
-- Prepara el terreno para portar las features del repo `mantenimiento`:
-- deja los permisos diciendo lo mismo de los dos lados, y las tablas nuevas
-- con los nombres del resto de la base.
-- ============================================================

-- ── 1. admin_sistema, igual en la app y en la base ───────────
--
-- `mant_nivel()` miraba sólo `usuario_modulos`, pero `nivelEnModulo()` del
-- código le da nivel admin a cualquier `admin_sistema` en todos los módulos.
-- Con las dos reglas distintas, un admin del sistema sin grant explícito veía
-- los botones de edición y RLS le devolvía listas vacías: la app le decía que
-- podía y la base no lo dejaba.
--
-- Se alinea la base al código, que es el criterio que ya rige en RRHH,
-- Remises y Mantenimiento.
create or replace function mant_nivel(uid uuid default auth.uid())
returns nivel_acceso
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from usuarios u where u.id = uid and u.rol = 'admin_sistema')
      then 'admin'::nivel_acceso
    else (
      select um.nivel
      from usuario_modulos um
      where um.usuario_id = uid and um.modulo = 'mantenimiento'
      order by um.nivel desc
      limit 1
    )
  end
$$;

comment on function mant_nivel(uuid) is
  'Nivel del usuario en el módulo mantenimiento. Un admin_sistema tiene admin '
  'en todos los módulos, igual que nivelEnModulo() en el código.';

-- ── 2. Las tablas nuevas, con los nombres de la casa ─────────
--
-- El delta las trajo en inglés desde la app de origen. En esta base todo lo
-- demás está en español —equipos, sectores, ordenes_trabajo, equipos_checklists—
-- y dos idiomas conviviendo se pagan en cada consulta que alguien escribe.
-- Se renombran ahora que están vacías: nunca va a ser más barato.
--
-- `produccion_semanal` y no `produccion_plan` porque ya existe
-- `planificacion_diaria`, y son cosas distintas: una es el plan de trabajo del
-- día, la otra el estado de producción de la semana por sector.

alter table if exists production_plan       rename to produccion_semanal;
alter table if exists equipment_types       rename to equipos_tipos;
alter table if exists equipment_components  rename to equipos_componentes;
alter table if exists equipment_parts       rename to equipos_repuestos;
alter table if exists work_order_parts      rename to ordenes_trabajo_repuestos;

alter index if exists production_week_idx    rename to produccion_semanal_semana_idx;
alter index if exists components_equipment_idx rename to equipos_componentes_equipo_idx;
alter index if exists parts_equipment_idx    rename to equipos_repuestos_equipo_idx;
alter index if exists wo_parts_idx           rename to ordenes_trabajo_repuestos_ot_idx;

-- ── 3. Las policies siguen a los nombres nuevos ──────────────
-- Renombrar la tabla no renombra sus policies, y quedarían nombradas por una
-- tabla que ya no existe.

do $$
declare t text;
begin
  -- Operativas: leer con acceso al módulo, escribir con edición.
  foreach t in array array[
    'avisos', 'ordenes_servicio', 'os_comparativas',
    'produccion_semanal', 'ordenes_trabajo_repuestos'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format(
      'create policy %I on %I for select to authenticated using (mant_puede_ver())',
      t || '_read', t);
    execute format(
      'create policy %I on %I for all to authenticated using (mant_puede_editar())',
      t || '_write', t);
  end loop;

  -- Configuración: escribir sólo con admin del módulo.
  foreach t in array array[
    'operarios', 'contratistas', 'equipos_tipos', 'equipos_componentes', 'equipos_repuestos'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format(
      'create policy %I on %I for select to authenticated using (mant_puede_ver())',
      t || '_read', t);
    execute format(
      'create policy %I on %I for all to authenticated using (mant_es_admin())',
      t || '_write', t);
  end loop;
end $$;

-- Las policies viejas quedaron nombradas por la tabla en inglés: se limpian.
drop policy if exists production_plan_read       on produccion_semanal;
drop policy if exists production_plan_write      on produccion_semanal;
drop policy if exists equipment_types_read       on equipos_tipos;
drop policy if exists equipment_types_write      on equipos_tipos;
drop policy if exists equipment_components_read  on equipos_componentes;
drop policy if exists equipment_components_write on equipos_componentes;
drop policy if exists equipment_parts_read       on equipos_repuestos;
drop policy if exists equipment_parts_write      on equipos_repuestos;
drop policy if exists work_order_parts_read      on ordenes_trabajo_repuestos;
drop policy if exists work_order_parts_write     on ordenes_trabajo_repuestos;
