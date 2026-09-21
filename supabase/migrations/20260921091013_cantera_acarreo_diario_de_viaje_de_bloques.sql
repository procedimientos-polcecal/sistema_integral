-- ============================================================
-- SdG — Cantera: acarreo diario (hoy, sólo viaje de bloques)
--
-- `cantera_acarreos` (20260914091110) guarda las 3 actividades sin pesada
-- (horas de destape, viaje de bloques, horas de bochones) como UN TOTAL POR
-- MES — "Siempre el día 1: es un total mensual, no una fecha de evento",
-- dice su propio comentario. Eso alcanza para pagarle al fletero, pero no
-- para saber cuánto se acarreó un día puntual.
--
-- El usuario pidió justo eso: poder cargar "viaje de bloques" por fecha,
-- porque esos viajes son el acarreo real de Cantera hacia Planta 2 de
-- Trituración (Planta 2 casi no tiene pesada de balanza con destino "PT 2"
-- — sólo 9 en todo 2026 — así que hoy no hay forma de saber cuánto le llegó
-- un día dado, a diferencia de Planta 1 y 3 que sí tienen `cantera_pesadas`).
--
-- Se agrega una tabla NUEVA en vez de sumarle `fecha` a `cantera_acarreos`:
-- esa tabla ya calcula el pago mensual (`montoAcarreo`, tarifa vigente por
-- mes) contra un total tipeado directo, verificado contra la planilla real.
-- Mezclar ahí un total mensual y filas diarias del mismo tipo/fletero
-- obligaría a decidir cuál manda para no pagarle dos veces lo mismo — un
-- riesgo que no hace falta correr para esto. Las dos tablas conviven sin
-- relación: la nueva es de sólo lectura para Trituración, la vieja sigue
-- siendo la que paga.
--
-- `tipo` queda genérico (no sólo "viaje_de_bloques") por si mañana hace
-- falta lo mismo para horas de destape u horas de bochones — mismo criterio
-- que ya usa `cantera_acarreos`, sin inventar una tabla por tipo.
-- ============================================================

create table if not exists cantera_acarreo_diario (
  id                  uuid primary key default gen_random_uuid(),
  tipo                text not null,
  fecha               date not null,
  -- En la unidad del tipo — viajes para "viaje_de_bloques", horas para los
  -- otros dos. Mismo criterio que `cantera_acarreos.cantidad`.
  cantidad            numeric not null,
  observaciones       text,
  cargado_por         uuid references usuarios(id),
  cargado_en          timestamptz not null default now(),
  actualizado_por     uuid references usuarios(id),
  actualizado_en      timestamptz,
  -- Un tipo, un día: cargar de nuevo el mismo día corrige el que ya estaba,
  -- no lo duplica — mismo criterio que `cantera_acarreos`.
  unique (tipo, fecha)
);

comment on table cantera_acarreo_diario is
  'Cuánto se acarreó un día puntual, de las actividades sin pesada (hoy sólo se carga viaje_de_bloques desde la pantalla). NO participa del pago al fletero —eso lo sigue calculando cantera_acarreos, el total mensual tipeado—: existe para que otro módulo (Trituración) pueda mostrar cuánto llegó un día dado.';

create index if not exists cantera_acarreo_diario_fecha_idx on cantera_acarreo_diario (fecha);
create index if not exists cantera_acarreo_diario_tipo_idx on cantera_acarreo_diario (tipo);

alter table cantera_acarreo_diario enable row level security;

drop policy if exists cantera_acarreo_diario_select on cantera_acarreo_diario;
create policy cantera_acarreo_diario_select on cantera_acarreo_diario
  for select to authenticated using (tiene_acceso_cantera());
drop policy if exists cantera_acarreo_diario_write on cantera_acarreo_diario;
create policy cantera_acarreo_diario_write on cantera_acarreo_diario
  for all to authenticated using (puede_editar_cantera()) with check (puede_editar_cantera());

notify pgrst, 'reload schema';
