-- ============================================================
-- SdG — Inventario se conecta con Mantenimiento y con Compras
--
-- Dos enlaces y una corrección.
-- ============================================================

-- ── 1. Lo que la celda decía, tal cual ───────────────────────
--
-- Esto corrige una decisión de la 046. Ahí `stock_actual` quedó `not null
-- default 0` —lo necesita el RPC, que hace aritmética con él— y el parser cae a
-- cero cuando la celda del listado viene vacía.
--
-- El problema aparece ahora, cuando Mantenimiento pasa a leer esta tabla en vez
-- de la planilla: su pantalla de repuestos distingue **cero** de **sin
-- informar**, y con razón. Su propio comentario lo dice: cero es un dato —no
-- hay— y vacío quiere decir que nadie lo contó, y mostrarlo como cero manda a
-- comprar algo que puede estar. `estadoDe()` devuelve `sin_dato` cuando el stock
-- es null, y sin esta columna esa rama no volvería a darse nunca.
--
-- Así que se guardan los dos: `stock_actual` para operar, y `stock_planilla`
-- para saber si alguien lo contó alguna vez.

alter table inventario_articulos
  add column if not exists stock_planilla numeric;

comment on column inventario_articulos.stock_planilla is
  'Lo que decía la celda de stock del listado, sin interpretar. NULL = la celda estaba vacía, o sea nadie lo contó, que no es lo mismo que cero.';

-- ── 2. La entrada al pañol y su requerimiento ────────────────
--
-- La planilla del almacén ya trae el N° de RI en su columna A, y la 046 lo
-- guarda en `ri`. Acá se le suma el enlace al requerimiento de Compras.
--
-- Vale la pena decir para qué: una entrada al pañol con un RI **es la recepción
-- de ese pedido**, y el seguimiento de la recepción es el pendiente número 1 de
-- COMPRAS-ESTADO. `RECIBIDO` y `fecha_recepcion` ya existen desde la 017.
--
-- Pero el sistema **no** marca el RI como recibido solo. Una entrega parcial
-- cerraría un pedido entero, y decidir que una compra está completa es de quien
-- la recibió. Se muestra en el requerimiento y hay un botón; el criterio es el
-- mismo de los proveedores y las ubicaciones — sugerir, no concluir.

alter table inventario_movimientos
  add column if not exists requerimiento_id uuid
    references compras_requerimientos(id) on delete set null;

create index if not exists inventario_mov_requerimiento_idx
  on inventario_movimientos (requerimiento_id)
  where requerimiento_id is not null;

comment on column inventario_movimientos.requerimiento_id is
  'El requerimiento de Compras que trajo este material, resuelto por nro_ri. Null cuando el RI no existe o la planilla no lo trae: no se enlaza al que se le parece.';
