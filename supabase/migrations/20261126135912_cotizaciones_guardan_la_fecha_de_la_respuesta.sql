-- ============================================================
-- SdG — Cotizaciones guardan la fecha de la respuesta
--
-- La FECHA de la planilla de Compras es el día en que contestó el proveedor,
-- no el día del pedido. Medido el 26/11/2026 sobre 323 filas cuyo RI existe en
-- la base: el 74% difiere de compras_requerimientos.fecha, y cuando difiere la
-- mediana es +3 días, con 233 de 238 posteriores al pedido.
--
-- compras_cotizaciones no tenía dónde guardarla: sólo created_at. Y created_at
-- no sirve, porque es el día en que alguien cargó la respuesta, no el día en
-- que llegó: una respuesta de ayer cargada hoy quedaría con la fecha de hoy, y
-- esa diferencia es exactamente lo que mide el 74%.
--
-- Es `date` y no `timestamptz` a propósito: lo que se registra es el día en que
-- contestó el proveedor, leído de un mensaje de WhatsApp. No hay hora que
-- valga, y un timestamptz invitaría a un error de zona horaria sobre un dato
-- que nadie midió al minuto.
--
-- Nullable y sin default: las respuestas ya cargadas no tienen fecha de
-- respuesta conocida, y inventarles una (por ejemplo la del pedido, que es el
-- error que ya cometió la carga por RI en los 8 presupuestos existentes) sería
-- peor que dejarlas en null. Se corrigen aparte.
--
-- Es sólo DDL, así que la aplica una persona a mano en el editor SQL. Se puede
-- correr más de una vez: `if not exists` en la columna, y `comment on` es
-- idempotente.
-- ============================================================

alter table public.compras_cotizaciones
  add column if not exists fecha_respuesta date;

comment on column public.compras_cotizaciones.fecha_respuesta is
  'Día en que contestó el proveedor. No es la fecha del pedido ni created_at (el día de la carga). Null si no se conoce.';
