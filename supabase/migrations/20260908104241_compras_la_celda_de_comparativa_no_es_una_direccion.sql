-- ============================================================
-- SdG — Compras: la celda de comparativa no es una dirección
--
-- `comparativa_url` tiene el texto "LINK" en 1.905 requerimientos de 1.948.
-- No es un dato: es lo que muestra la celda de la planilla, que esconde el
-- hipervínculo detrás. La sincronización la leía con la API de valores —que
-- devuelve el texto visible— y lo guardaba como si fuera la dirección.
--
-- Dos consecuencias que se veían en pantalla:
--
--   * la ficha ofrecía "Ver comparativa" con href="LINK", o sea un enlace
--     relativo a /compras/requerimientos/LINK. Lo mismo la bandeja.
--   * la exportación a la planilla escribe esta columna en la celda de
--     comparativa. Con "LINK" era inocuo de casualidad —escribía lo mismo que
--     ya estaba—, pero para los 36 RI que la tenían vacía escribía "" y
--     borraba el link que la planilla sí tenía.
--
-- Desde ahora la sincronización guarda el archivo en `comparativa_drive_id`,
-- que es de donde sale el link, y no toca `comparativa_url`: esa columna queda
-- para la comparativa que decidió la app. La exportación ya no escribe la celda
-- cuando la app no tiene nada que poner.
--
-- Por qué se apaga el trigger para el update
--
-- `compras_marcar_editado_en_app` mira `comparativa_url`, así que un update
-- masivo de esta columna marcaría 1.905 requerimientos como gestionados en la
-- app y los sacaría de la sincronización para siempre. Es justo lo contrario de
-- lo que hace esta migración. Se apaga, se limpia y se vuelve a encender: el
-- valor que se borra nunca fue una decisión de nadie.
--
-- La salida de la 027 —no marcar cuando la escritura actualiza
-- `sheets_sincronizado_en`— no sirve acá: haría que 1.905 requerimientos digan
-- que la planilla se leyó ahora, y esa fecha es la que se mira para saber si el
-- espejo quedó viejo. Mentirle a un dato para no tocar un trigger sale más
-- caro que apagar el trigger.
--
-- Es idempotente: correrla de nuevo no encuentra filas que cambiar.
-- ============================================================

alter table compras_requerimientos
  disable trigger compras_requerimientos_editado_app;

update compras_requerimientos
   set comparativa_url = null
 where comparativa_url is not null
   and comparativa_url !~* '^https?://';

alter table compras_requerimientos
  enable trigger compras_requerimientos_editado_app;

comment on column compras_requerimientos.comparativa_url is
  'La comparativa que decidió la app. Escribirla marca el RI como editado_en_app '
  '(trigger de la 017) y se exporta a la celda de comparativa de la planilla, así '
  'que sólo va una dirección de verdad: el vínculo con la planilla que anotó la '
  'hoja de área vive en comparativa_drive_id.';
