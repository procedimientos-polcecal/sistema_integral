-- ============================================================
-- SdG — Mantenimiento: lo que un aviso no pudo escribir en la planilla
--
-- Tercera y última tabla con el agujero que se encontró el 26/10/2026 al
-- revisar las 45 escrituras a planillas del repo. Las OT lo cerraron en
-- `20261018161658`, las órdenes de servicio en `20261026112137`, y los avisos
-- quedaron declarados como hueco conocido en el registro de
-- `scripts/revisar-exportaciones.mjs`. Esto los cierra.
--
-- QUÉ PASABA
--
-- Tres caminos escriben la planilla de avisos **después** de guardar y, si la
-- escritura fallaba, sólo le avisaban a la pantalla: enlazar una OT (columna
-- `OT ASIGNADA`), desestimar un aviso y retomarlo (columna `OBSERVACIONES`).
-- `filaDeAviso` vuelve a leer las dos columnas, así que la próxima corrida de
-- `sincronizarAvisos` las pisaba con la celda vacía.
--
-- No se perdía la decisión —`work_order_id` y `desestimado_en` no se importan,
-- y son los que mandan en `finalDelAviso` y `estaDesestimado`— pero la planilla
-- no se enteraba nunca, y la planilla es lo que mira quien no entra al sistema.
--
-- POR QUÉ SON TRES COLUMNAS Y NO DOS COMO EN LAS OT Y LAS OS
--
-- Esta es la parte que no se deduce, y es la razón de `sheets_pendiente_campos`.
--
-- En las OT y en las OS el drenaje reescribe **el registro entero armado desde
-- la fila**, porque todas esas columnas las escribe el sistema. Acá no: la
-- columna `OT ASIGNADA` la escriben **a mano**, y es el caso normal y no el
-- raro — 182 de 186, medido, y por eso `loQueImpideDesenlazar` se niega a
-- vaciarla cuando el sistema no tiene la orden enlazada.
--
-- Entonces un drenaje que reescribiera las dos columnas desde la fila podría
-- vaciar un número que alguien acaba de tipear y la sincronización todavía no
-- importó, por culpa de un fallo que fue de la OTRA columna: desestimar lee la
-- copia del sistema para negarse, y esa copia está vacía hasta el próximo sync.
-- Guardando qué campo falló, el drenaje completa **exactamente la operación que
-- no salió** y no toca una celda que la app nunca escribió.
--
-- Medido el 29/10/2026 contra la planilla de producción: 202 avisos de los dos
-- lados, 199 celdas con `OT ASIGNADA` y 5 con `OBSERVACIONES`, y **cero** donde
-- la planilla tenga texto que el sistema no tenga. O sea que hoy el riesgo es
-- la ventana entre una edición a mano y el sync siguiente — angosta, y la que
-- esta columna cierra.
-- ============================================================

alter table avisos
  add column if not exists sheets_pendiente        text,
  add column if not exists sheets_pendiente_campos text,
  add column if not exists sheets_intentado_en     timestamptz;

comment on column avisos.sheets_pendiente is
  'Por qué el enlace con la OT o la observación de la desestimación todavía no llegaron a la planilla. Lo pone la ruta y lo limpia la sincronización cuando logra escribirlo. Mientras tenga algo, la importación NO pisa ese aviso: la planilla todavía no sabe lo que el sistema sabe.';

comment on column avisos.sheets_pendiente_campos is
  'Qué columnas hay que reescribir, separadas por coma: ot_asignada, observaciones. A diferencia de las OT y las OS, acá el drenaje NO rearma todo desde la fila — OT ASIGNADA la escriben a mano (182 de 186) y reescribirla por un fallo de la otra columna podría vaciar un número que el sync todavía no importó.';

comment on column avisos.sheets_intentado_en is
  'Cuándo se intentó por última vez. Sirve para ver si una cola dejó de avanzar, que es distinto de una cola corta.';

-- Sólo los pendientes, que son un puñado contra 202 filas. Parcial a propósito
-- y nunca como destino de un `ON CONFLICT`: ahí no sirve (trampa 2 del README).
create index if not exists avisos_sheets_pendiente_idx
  on avisos (sheets_pendiente)
  where sheets_pendiente is not null;
