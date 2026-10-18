-- ============================================================
-- SdG — Mantenimiento: lo que el alta no pudo escribir en la planilla
--
-- Una OT creada desde el sistema puede nacer **ya realizada**: de las seis que
-- se cargaron en la app hasta el 18/10/2026, cinco vinieron con fecha de
-- cierre, horas y operarios. Eso no es un caso raro sino el más común — no se
-- está pidiendo trabajo, se está cargando trabajo ya hecho.
--
-- El estado, el cierre, las horas y los operarios viven en las columnas
-- literales del master (`K`, `M`, `N`, `O`, `P`, `Q`), y el alta **no las puede
-- escribir en el momento**: la fila del master todavía no existe, porque llega
-- por `IMPORTRANGE` desde la hoja de respuestas y eso tarda.
--
-- El precio de no tener dónde anotarlo, medido: el cron de las 06:00 lee la
-- columna `M` y pisa el estado del sistema con lo que diga. Las cinco OT que
-- hoy siguen en REALIZADO lo están **porque alguien les escribió "Realizado" a
-- mano en la planilla**. Con las horas pasa lo mismo y es peor: la
-- sincronización las lee de la `O`, encuentra vacío y las pisa con null.
--
-- Es la misma cola que `compras_requerimientos.sheets_pendiente`, por la misma
-- razón y con los mismos dos campos.
-- ============================================================

alter table ordenes_trabajo
  add column if not exists sheets_pendiente    text,
  add column if not exists sheets_intentado_en timestamptz;

comment on column ordenes_trabajo.sheets_pendiente is
  'Por qué el estado, el cierre, las horas o los operarios todavía no llegaron al master. Lo pone el alta y lo limpia la sincronización cuando logra escribirlos. Mientras tenga algo, la importación NO pisa esa orden: la planilla todavía no sabe lo que el sistema sabe.';

comment on column ordenes_trabajo.sheets_intentado_en is
  'Cuándo se intentó por última vez. Sirve para ver si una cola dejó de avanzar, que es distinto de una cola corta.';

-- Sólo las pendientes, que son un puñado contra 2.200 filas.
create index if not exists ordenes_trabajo_sheets_pendiente_idx
  on ordenes_trabajo (sheets_pendiente)
  where sheets_pendiente is not null;
