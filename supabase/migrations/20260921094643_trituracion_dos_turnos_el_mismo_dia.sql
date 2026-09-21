-- ============================================================
-- SdG — Trituración: más de un turno el mismo día
--
-- El usuario pidió poder cargar, en un mismo día y planta, dos (o más)
-- segmentos con material y horario distinto — ej. 04:00-08:00 con Dolomita,
-- 08:00-12:00 con Chocolata. El diseño original (`unique(planta_id, fecha)`,
-- migración 20260918105944) asumía un solo parte por día: era lo que decía
-- el Excel real relevado ("el Excel nunca tiene dos filas la misma fecha"),
-- pero esa afirmación ya había resultado falsa en el 2% del histórico
-- importado (4 de 179 días, ver lib/trituracion/importar.ts,
-- combinarPartesDelMismoDia) y ahora hace falta soportarlo de verdad, no
-- sólo importarlo combinado.
--
-- `orden` (1, 2, 3…) distingue los turnos de un mismo día — no `hora_inicio`,
-- porque un turno puede cargarse sin horario todavía (parte a medio llenar)
-- y dos turnos no pueden compartir el mismo número por accidente de tipeo
-- como sí podrían compartir la misma hora. Con default 1, los 175 partes ya
-- cargados (todos de un solo turno) quedan intactos sin tocar una fila.
--
-- `unique(planta_id, fecha)` pasa a `unique(planta_id, fecha, orden)`: ahora
-- se puede haber más de una fila por día, una por turno.
--
-- LO QUE ESTO NO RESUELVE: el espejo a Sheets (`lib/trituracion/espejo.ts`)
-- busca la fila a reescribir por fecha, sin `orden` — con dos turnos el
-- mismo día, el segundo guardado va a pisar la fila que ya escribió el
-- primero en la planilla, no crear una segunda. Queda documentado, no
-- arreglado en este commit: el espejo todavía no está activo en producción
-- (falta el permiso de editor en la planilla, ver docs/VARIABLES-VERCEL.md),
-- así que no hay una fila real que se esté pisando todavía.
-- ============================================================

alter table trituracion_partes add column if not exists orden smallint not null default 1;

alter table trituracion_partes drop constraint trituracion_partes_planta_id_fecha_key;
alter table trituracion_partes add constraint trituracion_partes_planta_fecha_orden_key unique (planta_id, fecha, orden);

comment on column trituracion_partes.orden is
  'Qué turno del día es (1, 2, 3…) cuando hay más de un registro en la misma planta y fecha. `unique(planta_id, fecha, orden)` reemplaza a `unique(planta_id, fecha)`.';

notify pgrst, 'reload schema';
