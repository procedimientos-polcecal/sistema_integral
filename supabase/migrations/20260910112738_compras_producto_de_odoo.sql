-- ============================================================
-- SdG — Compras: qué producto de Odoo le corresponde a un pedido
--
-- La orden de compra proponía siempre `ART. VARIOS`. El emparejador de
-- `lib/compras/productoOdoo.ts` acierta el 53% por la forma del nombre; esta
-- tabla es lo que hace que el resto se aprenda con el uso, en vez de quedarse
-- ahí para siempre.
--
-- Guarda la descripción NORMALIZADA y nunca generaliza por la primera palabra.
-- En el catálogo hay cabezas ambiguas —`LLAVE` es `LLAVE DE IMPACTO` o `LLAVES
-- ALLEN`, `TUBO` es `TUBO DE ENCASTRE` o un caño estructural—, así que atar la
-- cabeza a lo último que alguien eligió haría sugerir mal seguido. Y una
-- sugerencia mala que se confirma sin mirar es peor que no sugerir: el producto
-- equivocado no se nota, porque la descripción del pedido igual va en el texto
-- de la línea, y lo único que queda mal es la cuenta contable.
--
-- El id es de `product.product`, que es lo que lleva `purchase.order.line`, y
-- NO de `product.template`. El nombre se guarda al lado como copia para poder
-- mostrarlo sin salir a Odoo.
-- ============================================================

create table if not exists compras_producto_odoo (
  descripcion_normalizada text primary key,
  odoo_product_id         integer not null,
  odoo_product_nombre     text not null,
  -- Cuántas órdenes lo usaron. Sirve para saber qué se repite de verdad.
  veces                   integer not null default 1,
  created_by              uuid references usuarios(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

drop trigger if exists compras_producto_odoo_updated_at on compras_producto_odoo;
create trigger compras_producto_odoo_updated_at
  before update on compras_producto_odoo
  for each row execute function set_updated_at();

alter table compras_producto_odoo enable row level security;

-- Se lee para sugerir y se escribe al generar la orden, siempre desde el
-- servidor con el cliente admin. Igual queda legible para authenticated, como
-- el resto de los catálogos del módulo.
drop policy if exists compras_producto_odoo_lectura on compras_producto_odoo;
create policy compras_producto_odoo_lectura on compras_producto_odoo
  for select to authenticated using (true);

comment on table compras_producto_odoo is
  'Qué producto de Odoo (product.product) se eligió para una descripción de requerimiento. '
  'Se escribe al generar la orden, con lo confirmado. Sólo descripción exacta: no generaliza.';
