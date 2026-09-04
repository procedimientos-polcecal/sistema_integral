-- ============================================================
-- SdG — Ordenes servicio motivo rechazo
--
-- Denegar una OS le cierra la puerta a quien la pidió, y hasta ahora no había
-- dónde decirle por qué. Es más: denegar una OS no existía en el sistema —
-- ninguno de los cinco estados de ESTADOS_OS lo era, y en las 228 filas de la
-- tabla no había ninguna denegada—, aunque en la planilla sí se deniega
-- escribiendo el estado a mano. Esta columna es la mitad que faltaba de esa
-- salida.
--
-- El motivo NO se exporta a la planilla, y es una decisión tomada, no un
-- pendiente. La única columna de texto libre que la app escribe allá es
-- OBSERVACIONES, que es de uso general y tiene notas cargadas que no son
-- motivos: pisarla perdería datos, y agregar el motivo al final dejaría un
-- campo donde después no se puede distinguir una cosa de la otra. El estado
-- DENEGADO sí viaja a la planilla, que es lo que hace falta para que quien la
-- lee sepa que la OS está cerrada.
--
-- Nullable a propósito: las 228 filas que ya existen no tienen motivo y no hay
-- de dónde sacarlo. Inventar uno es peor que dejarlo vacío — un motivo
-- equivocado no se nota nunca.
--
-- La regla de que al denegar haga falta un motivo vive en la aplicación
-- (lib/mantenimiento/denegacion.ts) y no en un CHECK acá. No es descuido: la
-- sincronización importa de la planilla, que no tiene columna de motivo, así
-- que una restricción en la base haría fallar cada sync sobre una OS denegada a
-- mano. Es el mismo motivo por el que Compras tampoco lo tiene.
-- ============================================================

alter table ordenes_servicio
  add column if not exists motivo_rechazo text;

comment on column ordenes_servicio.motivo_rechazo is
  'Por qué se denegó la OS. Sólo lo carga la app: la planilla no tiene esta columna.';
