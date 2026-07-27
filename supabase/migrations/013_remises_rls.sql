-- ============================================================
-- SdG — Módulo Remises: RLS
-- ============================================================

create or replace function public.puede_editar_remises()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
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
    es_admin() or exists (
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
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'remises'
    ),
    false
  )
$$;

-- ¿El empleado vinculado a la sesión actual (si hay uno) es dueño de este
-- asiento? Usada por la vista de auto-servicio "Mi remis", independiente
-- del nivel de módulo — un empleado sin ningún acceso al panel de admin
-- igual puede ver su propia asignación.
create or replace function public.es_mi_asiento(p_empleado_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select empleado_id from usuarios where id = auth.uid()) = p_empleado_id,
    false
  )
$$;

-- ¿La sesión actual tiene un asiento propio en esta hoja de ruta? Deja ver
-- a los "compañeros de viaje" (el resto de los asientos de la misma hoja),
-- no solo el propio — sin esto "Mi remis" no podría mostrar quién más va.
create or replace function public.es_mi_hoja_ruta(p_hoja_ruta_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    exists (
      select 1 from asientos
      where hoja_ruta_id = p_hoja_ruta_id and es_mi_asiento(empleado_id)
    ),
    false
  )
$$;

alter table choferes                    enable row level security;
alter table vehiculos                   enable row level security;
alter table remises_turnos              enable row level security;
alter table remises_empleados_datos     enable row level security;
alter table remises_asistencia          enable row level security;
alter table remises_plan_semana         enable row level security;
alter table hojas_ruta                  enable row level security;
alter table asientos                    enable row level security;
alter table remises_plantillas          enable row level security;
alter table remises_plantillas_grupos   enable row level security;
alter table remises_config              enable row level security;
alter table remises_push_tokens         enable row level security;

-- choferes/vehiculos: acceso de módulo normal, MÁS lectura para el
-- empleado vinculado si el chofer/vehículo aparece en una hoja de ruta
-- donde tiene un asiento (auto-servicio "Mi remis" necesita mostrar
-- vehículo y chofer, no solo el asiento).
create policy choferes_select on choferes for select to authenticated using (
  tiene_acceso_remises() or exists (
    select 1 from hojas_ruta where hojas_ruta.chofer_id = choferes.id and es_mi_hoja_ruta(hojas_ruta.id)
  )
);
create policy choferes_write  on choferes for all    to authenticated using (puede_editar_remises()) with check (puede_editar_remises());

create policy vehiculos_select on vehiculos for select to authenticated using (
  tiene_acceso_remises() or exists (
    select 1 from hojas_ruta where hojas_ruta.vehiculo_id = vehiculos.id and es_mi_hoja_ruta(hojas_ruta.id)
  )
);
create policy vehiculos_write  on vehiculos for all    to authenticated using (puede_editar_remises()) with check (puede_editar_remises());

create policy remises_turnos_select on remises_turnos for select to authenticated using (tiene_acceso_remises());
create policy remises_turnos_write  on remises_turnos for all    to authenticated using (es_admin_remises()) with check (es_admin_remises());

create policy remises_empleados_datos_select on remises_empleados_datos for select to authenticated using (tiene_acceso_remises());
create policy remises_empleados_datos_write  on remises_empleados_datos for all    to authenticated using (puede_editar_remises()) with check (puede_editar_remises());

create policy remises_asistencia_select on remises_asistencia for select to authenticated using (tiene_acceso_remises());
create policy remises_asistencia_write  on remises_asistencia for all    to authenticated using (puede_editar_remises()) with check (puede_editar_remises());

create policy remises_plan_semana_select on remises_plan_semana for select to authenticated using (tiene_acceso_remises());
create policy remises_plan_semana_write  on remises_plan_semana for all    to authenticated using (puede_editar_remises()) with check (puede_editar_remises());

-- hojas_ruta: acceso de módulo normal, MÁS lectura para el empleado
-- vinculado si tiene un asiento en esa hoja (auto-servicio "Mi remis"
-- necesita el vehículo/chofer/hora de salida de su propia hoja de ruta).
create policy hojas_ruta_select on hojas_ruta for select to authenticated using (
  tiene_acceso_remises() or es_mi_hoja_ruta(hojas_ruta.id)
);
create policy hojas_ruta_write  on hojas_ruta for all    to authenticated using (puede_editar_remises()) with check (puede_editar_remises());

-- asientos: acceso de módulo normal, MÁS lectura propia para el empleado
-- vinculado (auto-servicio), sin pasar por tiene_acceso_remises().
create policy asientos_select on asientos for select to authenticated using (tiene_acceso_remises() or es_mi_hoja_ruta(hoja_ruta_id));
create policy asientos_write  on asientos for all    to authenticated using (puede_editar_remises()) with check (puede_editar_remises());

create policy remises_plantillas_select on remises_plantillas for select to authenticated using (tiene_acceso_remises());
create policy remises_plantillas_write  on remises_plantillas for all    to authenticated using (puede_editar_remises()) with check (puede_editar_remises());

create policy remises_plantillas_grupos_select on remises_plantillas_grupos for select to authenticated using (tiene_acceso_remises());
create policy remises_plantillas_grupos_write  on remises_plantillas_grupos for all    to authenticated using (puede_editar_remises()) with check (puede_editar_remises());

create policy remises_config_select on remises_config for select to authenticated using (tiene_acceso_remises());
create policy remises_config_write  on remises_config for all    to authenticated using (es_admin_remises()) with check (es_admin_remises());

-- remises_push_tokens: cada usuario gestiona su propia suscripción (admin
-- o empleado de auto-servicio, cualquiera puede tener una); el cron job
-- que envía las notificaciones usa el cliente con service role, no RLS.
create policy remises_push_tokens_own on remises_push_tokens for all to authenticated
  using (usuario_id = auth.uid())
  with check (usuario_id = auth.uid());
