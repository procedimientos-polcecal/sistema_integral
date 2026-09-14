import { llamar, idDeRelacion, nombreDeRelacion } from "./client";
import type { HistorialDeCuentas, VecesPorCuenta } from "@/lib/facturacion/sugerirCuenta";

/**
 * A qué cuenta contable fue cada compra que este proveedor ya facturó.
 *
 * Es lo que permite proponer la cuenta de una línea en vez de elegirla a mano
 * siempre. La regla —y los umbrales, que salen de un backtest— viven en
 * `lib/facturacion/sugerirCuenta.ts`, que es pura. Acá va sólo el viaje.
 *
 * Se pide por **`read_group`** y no trayendo las líneas: Odoo cuenta del lado
 * del servidor y vuelve una decena de combinaciones en vez de cientos de filas.
 * Medido contra el proveedor con más historia de la instancia —RUBIALES, 294
 * facturas—: 12 combinaciones, 220 ms.
 *
 * Se consulta **por factura y en vivo**, no con una tabla local que haya que
 * mantener: el historial cambia cada vez que contabilidad imputa algo, y una
 * copia desactualizada propondría lo que el grupo dejó de hacer.
 */

/** Sólo lo que efectivamente se contabilizó: un borrador no es un antecedente. */
function dominio(partnerId: number): unknown[] {
  return [
    ["move_id.move_type", "in", ["in_invoice", "in_refund"]],
    ["display_type", "=", "product"],
    ["parent_state", "=", "posted"],
    ["partner_id", "=", partnerId],
  ];
}

interface Grupo {
  product_id?: unknown;
  account_id?: unknown;
  __count: number;
}

export async function traerHistorialDeCuentas(partnerId: number): Promise<HistorialDeCuentas> {
  const [porProductoYCuenta, porCuenta] = await Promise.all([
    llamar<Grupo[]>(
      "account.move.line",
      "read_group",
      [dominio(partnerId), ["product_id", "account_id"], ["product_id", "account_id"]],
      { lazy: false, limit: 2000 }
    ),
    llamar<Grupo[]>(
      "account.move.line",
      "read_group",
      [dominio(partnerId), ["account_id"], ["account_id"]],
      { lazy: false, limit: 200 }
    ),
  ]);

  const porProducto: Record<string, VecesPorCuenta> = {};
  const nombres: Record<string, string> = {};

  for (const g of porProductoYCuenta) {
    const producto = idDeRelacion(g.product_id);
    const cuenta = idDeRelacion(g.account_id);
    if (producto === null || cuenta === null) continue;

    const clave = String(producto);
    porProducto[clave] ??= {};
    porProducto[clave][String(cuenta)] = (porProducto[clave][String(cuenta)] ?? 0) + g.__count;
    nombres[String(cuenta)] = nombreDeRelacion(g.account_id) ?? "";
  }

  const delProveedor: VecesPorCuenta = {};
  for (const g of porCuenta) {
    const cuenta = idDeRelacion(g.account_id);
    if (cuenta === null) continue;
    delProveedor[String(cuenta)] = g.__count;
    nombres[String(cuenta)] = nombreDeRelacion(g.account_id) ?? "";
  }

  return { porProducto, delProveedor, nombres };
}
