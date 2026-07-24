-- ============================================================
-- SdG — Módulo Mantenimiento: RLS + storage
-- ============================================================

alter table equipos                    enable row level security;
alter table equipos_checklists         enable row level security;
alter table mantenimientos_programados enable row level security;
alter table mantenimientos_ejecuciones enable row level security;
alter table equipos_status_log         enable row level security;
alter table ordenes_trabajo            enable row level security;
alter table planificacion_diaria       enable row level security;
alter table planificacion_diaria_items enable row level security;

-- equipos / checklists / status_log: lectura abierta, escritura gateada.
create policy equipos_select on equipos for select to authenticated using (true);
create policy equipos_write  on equipos for all    to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());

create policy equipos_checklists_select on equipos_checklists for select to authenticated using (true);
create policy equipos_checklists_write  on equipos_checklists for all    to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());

create policy equipos_status_log_select on equipos_status_log for select to authenticated using (true);
create policy equipos_status_log_write  on equipos_status_log for all    to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());

-- mantenimientos_programados: cualquier miembro del módulo puede actualizar
-- (necesario al registrar una ejecución, que avanza next_date); crear/borrar
-- programaciones requiere nivel de edición.
create policy mp_select on mantenimientos_programados for select to authenticated using (true);
create policy mp_update on mantenimientos_programados for update to authenticated using (tiene_acceso_mantenimiento()) with check (tiene_acceso_mantenimiento());
create policy mp_insert on mantenimientos_programados for insert to authenticated with check (puede_editar_mantenimiento());
create policy mp_delete on mantenimientos_programados for delete to authenticated using (puede_editar_mantenimiento());

-- mantenimientos_ejecuciones: cualquier miembro del módulo puede registrar una
-- ejecución; editar/borrar una ya registrada requiere nivel de edición.
create policy me_select on mantenimientos_ejecuciones for select to authenticated using (true);
create policy me_insert on mantenimientos_ejecuciones for insert to authenticated with check (tiene_acceso_mantenimiento());
create policy me_update on mantenimientos_ejecuciones for update to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());
create policy me_delete on mantenimientos_ejecuciones for delete to authenticated using (puede_editar_mantenimiento());

-- ordenes_trabajo / planificacion_diaria: lectura abierta, escritura gateada.
create policy ot_select on ordenes_trabajo for select to authenticated using (true);
create policy ot_write  on ordenes_trabajo for all    to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());

create policy pd_select on planificacion_diaria for select to authenticated using (true);
create policy pd_write  on planificacion_diaria for all    to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());

create policy pdi_select on planificacion_diaria_items for select to authenticated using (true);
create policy pdi_write  on planificacion_diaria_items for all    to authenticated using (puede_editar_mantenimiento()) with check (puede_editar_mantenimiento());

-- ── Storage: fotos de ejecuciones y de referencia de mantenimientos ────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'execution-photos',
  'execution-photos',
  false,
  10485760,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- Acotado a miembros del módulo (el original lo dejaba abierto a cualquier
-- autenticado, aceptable en una app standalone; acá el login es compartido con
-- RRHH/Remises, así que se restringe).
create policy mantenimiento_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'execution-photos' and tiene_acceso_mantenimiento());

create policy mantenimiento_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'execution-photos' and tiene_acceso_mantenimiento());

-- DELETE: cubre fotos de ejecución ({uid}/...) y fotos de referencia
-- ({schedules}/{scheduleId}/...) — el original sólo cubría el primer patrón,
-- lo que dejaba las fotos de referencia imborrables por policy.
create policy mantenimiento_photos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'execution-photos'
    and (
      auth.uid()::text = (storage.foldername(name))[1]
      or ((storage.foldername(name))[1] = 'schedules' and puede_editar_mantenimiento())
    )
  );
