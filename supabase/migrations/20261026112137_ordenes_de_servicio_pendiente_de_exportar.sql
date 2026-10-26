-- ============================================================
-- SdG — Mantenimiento: lo que el seguimiento de una OS no pudo escribir
--
-- Es el mismo agujero que el PATCH de las órdenes de trabajo tuvo hasta el
-- 26/10/2026 —el que costó las OT 2896 a 2898 y la 2908—, repetido en las
-- órdenes de servicio.
--
-- El PATCH de `ordenes-servicio` guarda el seguimiento (estado, proveedor
-- elegido, fecha de pedido, fecha de realización, observaciones), intenta
-- escribirlo en la planilla y, si falla, devuelve el motivo a la pantalla y
-- **nada más**. No había dónde anotarlo.
--
-- Y pisa, porque `filaDeOS` vuelve a leer esas cinco columnas: la próxima
-- corrida de `sincronizarOrdenesDeServicio` lee la celda vieja —o vacía— y la
-- sube encima de lo que se acababa de guardar. Sin error de por medio.
--
-- Cuánto está expuesto, medido el 26/10/2026 contra producción: **192 de las
-- 266 OS tienen seguimiento cargado**. No es un camino de borde.
--
-- Es la misma cola que `ordenes_trabajo.sheets_pendiente` (migración
-- `20261018161658`) y que `compras_requerimientos.sheets_pendiente`, por la
-- misma razón y con los mismos dos campos.
-- ============================================================

alter table ordenes_servicio
  add column if not exists sheets_pendiente    text,
  add column if not exists sheets_intentado_en timestamptz;

comment on column ordenes_servicio.sheets_pendiente is
  'Por qué el seguimiento —estado, proveedor, fechas, observaciones— todavía no llegó a la planilla. Lo pone el PATCH y lo limpia la sincronización cuando logra escribirlo. Mientras tenga algo, la importación NO pisa esa orden: la planilla todavía no sabe lo que el sistema sabe.';

comment on column ordenes_servicio.sheets_intentado_en is
  'Cuándo se intentó por última vez. Sirve para ver si una cola dejó de avanzar, que es distinto de una cola corta.';

-- Sólo las pendientes, que son un puñado contra 266 filas. Parcial a propósito
-- y nunca como destino de un `ON CONFLICT`: ahí no sirve (trampa 2 del README).
create index if not exists ordenes_servicio_sheets_pendiente_idx
  on ordenes_servicio (sheets_pendiente)
  where sheets_pendiente is not null;
