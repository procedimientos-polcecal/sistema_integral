-- ============================================================
-- SdG — Taller Vial: estados diarios (OP / FS / OCF)
--
-- Espejo de "HISTORIAL ESTADOS" de la planilla real: una matriz fecha ×
-- equipo, con tres códigos por celda. OP = Operativo, FS = Fuera de
-- Servicio, OCF = Operativo Con Fallas (confirmado con el usuario). Igual
-- que las cargas de combustible, se sigue cargando en la planilla — acá sólo
-- se espeja para sacar indicadores (días fuera de servicio en el mes, etc.).
--
-- SIN ENUM: `estado` es texto con el vocabulario en
-- `lib/tallerVial/estados.ts`, mismo criterio que el resto de Cantera/Taller
-- Vial — un enum nuevo viaja solo en su propia migración (55P04) y acá no
-- hace falta esa integridad referencial para tres valores fijos.
--
-- CON CLAVE NATURAL, A DIFERENCIA DE `taller_vial_cargas`: un equipo tiene
-- **un solo** estado por día, así que `(equipo_id, fecha)` alcanza para un
-- upsert de verdad — no hace falta el borrar-y-recargar entero que sí hace
-- falta para las cargas (donde un mismo equipo puede cargar combustible más
-- de una vez el mismo día).
-- ============================================================

create table if not exists taller_vial_estados_diarios (
  id      uuid primary key default gen_random_uuid(),
  equipo_id uuid not null references equipos(id) on delete cascade,
  fecha     date not null,
  estado    text not null,
  created_at timestamptz not null default now(),
  unique (equipo_id, fecha)
);

comment on table taller_vial_estados_diarios is
  'El estado de un equipo en un día puntual (OPERATIVO / FUERA_DE_SERVICIO / OPERATIVO_CON_FALLAS), espejado de "HISTORIAL ESTADOS" de la planilla real. De acá salen los días fuera de servicio del mes, por equipo.';

create index if not exists taller_vial_estados_diarios_fecha_idx on taller_vial_estados_diarios (fecha);

alter table taller_vial_estados_diarios enable row level security;

-- Mismo criterio que taller_vial_cargas después del pivote a espejo: entra
-- por import (service role), no fila por fila desde una pantalla.
drop policy if exists taller_vial_estados_diarios_select on taller_vial_estados_diarios;
create policy taller_vial_estados_diarios_select on taller_vial_estados_diarios
  for select to authenticated using (tiene_acceso_taller_vial());
drop policy if exists taller_vial_estados_diarios_write on taller_vial_estados_diarios;
create policy taller_vial_estados_diarios_write on taller_vial_estados_diarios
  for all to authenticated using (es_admin_taller_vial()) with check (es_admin_taller_vial());

notify pgrst, 'reload schema';
