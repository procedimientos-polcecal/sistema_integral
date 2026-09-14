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

// ── La distribución analítica que ya se usó ──────────────────

/** Cuántas veces esta compra se repartió así. La clave es el JSON de Odoo. */
export type VecesPorReparto = Record<string, number>;

export interface HistorialDeAnalitica {
  porProducto: Record<string, VecesPorReparto>;
  delProveedor: VecesPorReparto;
}

/**
 * Cómo repartió este proveedor sus compras anteriores.
 *
 * A diferencia de la cuenta, esto **no se puede pedir con `read_group`**:
 * `analytic_distribution` es un campo JSON y Odoo no agrupa por él. Así que se
 * traen las líneas y se cuenta acá, acotado a las últimas 500 — que para el
 * proveedor con más historia del grupo son dos años de facturas, y lo viejo no
 * dice cómo se imputa hoy.
 */
export async function traerHistorialDeAnalitica(
  partnerId: number
): Promise<HistorialDeAnalitica> {
  const lineas = await llamar<
    { product_id: unknown; analytic_distribution: Record<string, number> | false }[]
  >("account.move.line", "search_read", [dominio(partnerId)], {
    fields: ["product_id", "analytic_distribution"],
    limit: 500,
    order: "id desc",
  });

  const porProducto: Record<string, VecesPorReparto> = {};
  const delProveedor: VecesPorReparto = {};

  for (const l of lineas) {
    if (!l.analytic_distribution || !Object.keys(l.analytic_distribution).length) continue;

    /*
     * La clave es el reparto entero y no cada cuenta suelta: repartir 50/50
     * entre dos equipos es una decisión distinta de mandarle todo a uno, y
     * contarlas por separado perdería justamente eso.
     */
    const reparto = JSON.stringify(
      Object.fromEntries(Object.entries(l.analytic_distribution).sort(([a], [b]) => a.localeCompare(b)))
    );

    delProveedor[reparto] = (delProveedor[reparto] ?? 0) + 1;

    const producto = idDeRelacion(l.product_id);
    if (producto === null) continue;
    const clave = String(producto);
    porProducto[clave] ??= {};
    porProducto[clave][reparto] = (porProducto[clave][reparto] ?? 0) + 1;
  }

  return { porProducto, delProveedor };
}
