-- ============================================================
-- SdG — Módulo RRHH: RLS
-- ============================================================

-- ¿El usuario actual puede editar dentro del módulo RRHH?
create or replace function public.puede_editar_rrhh()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'rrhh' and nivel in ('edicion', 'admin')
    ),
    false
  )
$$;

-- ¿Es admin del módulo RRHH? (equivalente al requireAdmin del original:
-- liquidaciones, jornadas, feriados, configuración, alta/baja de empleados).
create or replace function public.es_admin_rrhh()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'rrhh' and nivel = 'admin'
    ),
    false
  )
$$;

-- ¿Tiene acceso al módulo RRHH (cualquier nivel)? Los datos de RRHH son
-- sensibles (sueldos, motivos de ausencia) — a diferencia de Mantenimiento,
-- la lectura NO queda abierta a cualquier autenticado del SdG.
create or replace function public.tiene_acceso_rrhh()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    es_admin() or exists (
      select 1 from usuario_modulos
      where usuario_id = auth.uid() and modulo = 'rrhh'
    ),
    false
  )
$$;

alter table rrhh_empleados_datos  enable row level security;
alter table jornadas              enable row level security;
alter table rrhh_import_batches   enable row level security;
alter table rrhh_import_staging   enable row level security;
alter table fichadas              enable row level security;
alter table feriados              enable row level security;
alter table config_liquidacion    enable row level security;
alter table calculos_diarios      enable row level security;
alter table ausencias             enable row level security;
alter table vacaciones            enable row level security;
alter table francos               enable row level security;
alter table liquidaciones         enable row level security;

create policy rrhh_empleados_datos_select on rrhh_empleados_datos for select to authenticated using (tiene_acceso_rrhh());
create policy rrhh_empleados_datos_write  on rrhh_empleados_datos for all    to authenticated using (puede_editar_rrhh()) with check (puede_editar_rrhh());

create policy jornadas_select on jornadas for select to authenticated using (tiene_acceso_rrhh());
create policy jornadas_write  on jornadas for all    to authenticated using (es_admin_rrhh()) with check (es_admin_rrhh());

create policy feriados_select on feriados for select to authenticated using (tiene_acceso_rrhh());
create policy feriados_write  on feriados for all    to authenticated using (es_admin_rrhh()) with check (es_admin_rrhh());

create policy config_liquidacion_select on config_liquidacion for select to authenticated using (tiene_acceso_rrhh());
create policy config_liquidacion_write  on config_liquidacion for all    to authenticated using (es_admin_rrhh()) with check (es_admin_rrhh());

-- import_batches: lectura de quien tiene acceso al módulo; solo un admin de
-- RRHH puede disparar una importación (misma exigencia que el original).
create policy rrhh_import_batches_select on rrhh_import_batches for select to authenticated using (tiene_acceso_rrhh());
create policy rrhh_import_batches_write  on rrhh_import_batches for all    to authenticated using (es_admin_rrhh()) with check (es_admin_rrhh());

-- import_staging: cada usuario ve/gestiona solo su propio preview.
create policy rrhh_import_staging_own on rrhh_import_staging for all to authenticated
  using (usuario_id = auth.uid() or es_admin_rrhh())
  with check (usuario_id = auth.uid() or es_admin_rrhh());

create policy fichadas_select on fichadas for select to authenticated using (tiene_acceso_rrhh());
create policy fichadas_write  on fichadas for all    to authenticated using (puede_editar_rrhh()) with check (puede_editar_rrhh());

-- calculos_diarios: lo escribe el motor (server, cliente admin) y las dos
-- mutaciones manuales (validar extras / horas manuales) son admin-only,
-- igual que el original.
create policy calculos_diarios_select on calculos_diarios for select to authenticated using (tiene_acceso_rrhh());
create policy calculos_diarios_write  on calculos_diarios for all    to authenticated using (es_admin_rrhh()) with check (es_admin_rrhh());

create policy ausencias_select on ausencias for select to authenticated using (tiene_acceso_rrhh());
create policy ausencias_write  on ausencias for all    to authenticated using (puede_editar_rrhh()) with check (puede_editar_rrhh());

create policy vacaciones_select on vacaciones for select to authenticated using (tiene_acceso_rrhh());
create policy vacaciones_write  on vacaciones for all    to authenticated using (puede_editar_rrhh()) with check (puede_editar_rrhh());

create policy francos_select on francos for select to authenticated using (tiene_acceso_rrhh());
create policy francos_write  on francos for all    to authenticated using (puede_editar_rrhh()) with check (puede_editar_rrhh());

-- liquidaciones: toda la ruta era admin-only en el original.
create policy liquidaciones_select on liquidaciones for select to authenticated using (es_admin_rrhh());
create policy liquidaciones_write  on liquidaciones for all    to authenticated using (es_admin_rrhh()) with check (es_admin_rrhh());

-- empleados/sectores (núcleo): sumar a las policies ya existentes de la
-- Fase 0 (es_admin() global) la posibilidad de que un admin de RRHH
-- gestione empleados y cree/edite sectores transversales, sin requerir
-- admin_sistema.
create policy empleados_write_rrhh on empleados for all to authenticated using (es_admin_rrhh()) with check (es_admin_rrhh());
create policy sectores_write_rrhh  on sectores  for all to authenticated using (es_admin_rrhh()) with check (es_admin_rrhh());
