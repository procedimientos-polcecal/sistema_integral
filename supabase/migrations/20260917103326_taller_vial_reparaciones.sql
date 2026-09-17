-- ============================================================
-- SdG — Taller Vial: historial de reparaciones
--
-- Se carga desde el SdG, igual que los services por horómetro — la planilla
-- real tiene "HISTORIAL REPARACIONES" (51 filas) pero de acá en más se carga
-- acá; el histórico de la planilla se trae una sola vez con un script, igual
-- que se hizo con el de combustible.
--
-- SIN COLUMNA "PRÓXIMO SERVICE" (la planilla real la tiene): eso ya lo
-- calcula `lib/tallerVial/service.ts` a partir de `taller_vial_services`, y
-- una reparación puntual no es de dónde debería salir cuándo toca el próximo
-- service — mezclaría dos conceptos que en el SdG ya están separados.
--
-- `horas` y `horometro` son NULLABLE: en la planilla real casi ninguna fila
-- los trae cargados (de 51 filas relevadas, sólo un puñado). No se fuerza a
-- completar lo que en la práctica casi nunca se anota.
--
-- `tipo` sí se rescata de la planilla real: además de "Reparación", el
-- histórico tiene bastantes filas "Revisión" (una intervención más liviana:
-- engrase, sopleteo, niveles) y conviene distinguirlas — texto libre, no
-- enum, mismo criterio que el resto del módulo.
-- ============================================================

create table if not exists taller_vial_reparaciones (
  id            uuid primary key default gen_random_uuid(),
  equipo_id     uuid not null references equipos(id) on delete cascade,
  tipo          text not null default 'Reparación',
  fecha         date not null,
  descripcion   text not null,
  horas         numeric,
  horometro     numeric,
  observaciones text,
  cargado_por   uuid references usuarios(id),
  cargado_en    timestamptz not null default now()
);

comment on table taller_vial_reparaciones is
  'El historial de reparaciones de un equipo móvil: qué se le hizo, cuándo y con cuántas horas de mano de obra — se carga desde la app, no viene de un espejo.';

create index if not exists taller_vial_reparaciones_equipo_idx on taller_vial_reparaciones (equipo_id);
create index if not exists taller_vial_reparaciones_fecha_idx on taller_vial_reparaciones (fecha);

alter table taller_vial_reparaciones enable row level security;

drop policy if exists taller_vial_reparaciones_select on taller_vial_reparaciones;
create policy taller_vial_reparaciones_select on taller_vial_reparaciones
  for select to authenticated using (tiene_acceso_taller_vial());
drop policy if exists taller_vial_reparaciones_write on taller_vial_reparaciones;
create policy taller_vial_reparaciones_write on taller_vial_reparaciones
  for all to authenticated using (puede_editar_taller_vial()) with check (puede_editar_taller_vial());

notify pgrst, 'reload schema';
