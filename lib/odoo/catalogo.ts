/**
 * El catálogo de productos comprables de Odoo.
 *
 * Son `product.product` y no `product.template`: es lo que lleva el
 * `product_id` de `purchase.order.line`. Medido el 10/09/2026: 378 comprables,
 * todos compartidos entre las dos empresas y todos con unidad `Unidades`.
 *
 * Se lee entero —son 378 nombres, una llamada— porque el emparejador necesita
 * verlos todos para saber si hay empate, y la pantalla los necesita para el
 * selector.
 */

import { buscarLeer } from "@/lib/odoo/client";
import type { ProductoDeOdoo } from "@/lib/compras/productoOdoo";

/** La unidad de compra de cada producto, que la línea de la orden necesita. */
export interface ProductoComprable extends ProductoDeOdoo {
  uomId: number | null;
}

export async function leerCatalogoComprable(): Promise<ProductoComprable[]> {
  const crudos = await buscarLeer<{
    id: number;
    display_name: string;
    uom_po_id: [number, string] | false;
  }>(
    "product.product",
    [
      ["purchase_ok", "=", true],
      ["active", "=", true],
    ],
    ["display_name", "uom_po_id"],
    { limite: 2000, orden: "display_name asc" }
  );

  return crudos.map((p) => ({
    id: p.id,
    nombre: p.display_name,
    uomId: p.uom_po_id ? p.uom_po_id[0] : null,
  }));
}
