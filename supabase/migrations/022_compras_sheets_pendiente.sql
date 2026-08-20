-- ============================================================
-- SdG — Compras: qué quedó sin escribir en la planilla
--
-- Cuando la app aprueba un requerimiento y la planilla rechaza la celda —por
-- una protección, o porque falta el alias del aprobador—, el cambio queda
-- guardado en el sistema y la planilla no se entera. Hasta ahora eso terminaba
-- ahí: el aviso aparecía una vez en pantalla y se perdía. El RI quedaba
-- aprobado, así que la app ya no ofrecía aprobarlo de nuevo, y no había forma
-- de reintentar la escritura.
--
-- Con esto la deuda queda anotada en la fila y se puede reintentar: sola en
-- cada sincronización, o a mano desde Configuración.
-- ============================================================

alter table compras_requerimientos
  -- Qué campos no se pudieron escribir, con el motivo. Vacío = al día.
  add column if not exists sheets_pendiente text,
  add column if not exists sheets_intentado_en timestamptz;

comment on column compras_requerimientos.sheets_pendiente is
  'Campos que la planilla rechazó, con el motivo. NULL significa sincronizado.';

-- Índice parcial: la lista de pendientes es chica y se consulta seguido.
create index if not exists compras_req_sheets_pendiente_idx
  on compras_requerimientos (sheets_intentado_en)
  where sheets_pendiente is not null;

-- ── Los que ya se aprobaron desde la app antes de este cambio ──
-- Quedaron aprobados acá sin que la planilla se enterara, y como el
-- requerimiento ya no ofrece la acción de aprobar, no había forma de verlos.
-- Se marcan para que aparezcan en la lista y entren en el reintento.
--
-- `aprobado_en` distingue las aprobaciones hechas en el sistema: la importación
-- del histórico cargó `aprobador` pero nunca esa fecha.
update compras_requerimientos
set sheets_pendiente = 'aprobación (no se había escrito en la planilla)'
where aprobado_en is not null
  and estado_aprobacion in ('APROBADA', 'DENEGADA')
  and sheets_pendiente is null;
