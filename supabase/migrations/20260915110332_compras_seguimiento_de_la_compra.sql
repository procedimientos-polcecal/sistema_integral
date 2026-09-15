-- ============================================================
-- Seguimiento de la compra: la recepción
-- ============================================================
-- Un RI que llega a PEDIDO se quedaba ahí para siempre: hoy hay 1.787 en ese
-- estado y ninguno llegó nunca a RECIBIDO, porque la recepción vivía sólo en
-- el libro SEGUIMIENTO DE COMPRA, cargado a mano.
--
-- `fecha_pedido` y `fecha_recepcion` NO se agregan: ya existían y estaban
-- vacías. El esquema ya anticipaba esto.
--
-- Por qué texto con CHECK y no un enum: los valores son de la planilla
-- ("Si" / "Más o menos" / "No"), no del dominio, y agregar un valor a un enum
-- en este repo ya mordió dos veces. Un CHECK se cambia con un ALTER normal.
--
-- Por qué `seguimiento_pendiente` aparte de `sheets_pendiente`: son dos libros
-- distintos. Mezclados no hay forma de saber a cuál de los dos hay que ir.

alter table compras_requerimientos
  -- "Cant Pedida" de la planilla. Vacía significa "se compró lo que pedía el
  -- RI": coincide en el 99% de las 1.680 filas medidas, y las 25 que no son
  -- reales (el RI 250 pidió 100 y se compraron 95).
  add column if not exists cantidad_comprada numeric,
  add column if not exists cantidad_recibida numeric,
  -- Cuándo dijo Compras que iba a llegar. No confundir con `fecha_necesidad`,
  -- que es cuándo lo necesita quien pidió.
  add column if not exists fecha_estimada_recepcion date,
  add column if not exists cumplio_compras text
    check (cumplio_compras in ('SI', 'MAS_O_MENOS', 'NO')),
  add column if not exists cumplio_proveedor text
    check (cumplio_proveedor in ('SI', 'MAS_O_MENOS', 'NO')),
  -- En qué fila de `COMPRAS CON RI` quedó este RI. Sin esto habría que buscar
  -- la fila por la columna A en cada escritura, que son 1.759 filas.
  add column if not exists seguimiento_fila integer,
  add column if not exists seguimiento_pendiente text;

comment on column compras_requerimientos.seguimiento_fila is
  'Fila del master de SEGUIMIENTO DE COMPRA. Se escribe esa fila y nunca se inserta ni se ordena: las columnas de aplicación de cada pestaña por área viven al lado de un FILTER y son posicionales.';
