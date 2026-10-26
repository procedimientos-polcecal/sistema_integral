import { llamar, buscarLeer, idDeRelacion, nombreDeRelacion } from "./client";
import type {
  FacturaAnterior,
  LineaContabilizada,
} from "@/lib/facturacion/laLineaQueSeRepite";
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

// ── Las últimas facturas enteras, para la regla de la unanimidad ─────

/**
 * Las últimas `cuantas` facturas de este proveedor, con sus líneas.
 *
 * Es el único consumidor que **no** puede usar `read_group`: la unanimidad se
 * mide por factura y no en el agregado. Un proveedor que imputó 40 veces a
 * Fletes y 1 a Repuestos sale 97% en un `read_group` y **no es unánime** si esa
 * una es la última — y ésa es justamente la diferencia que decide si se pone o
 * se sugiere.
 *
 * Dos viajes y no uno: primero los ids de las tres facturas más nuevas, después
 * sus líneas. Leer líneas con un `limit` y agrupar después tiene un borde feo
 * —la factura más vieja de la ventana puede venir cortada por la mitad y
 * parecer unánime—, y acá un falso unánime se escribe solo en un asiento.
 *
 * Se acota a una empresa: Polcecal y Polysan pueden imputar distinto al mismo
 * proveedor, y mezclarlas haría que ninguna de las dos fuera unánime.
 */
export async function traerLasUltimasFacturas(
  partnerId: number,
  companyId: number,
  cuantas: number
): Promise<FacturaAnterior[]> {
  const movimientos = await buscarLeer<{ id: number }>(
    "account.move",
    [
      ["move_type", "in", ["in_invoice", "in_refund"]],
      ["state", "=", "posted"],
      ["partner_id", "=", partnerId],
      ["company_id", "=", companyId],
    ],
    ["id"],
    { limite: cuantas, orden: "invoice_date desc, id desc", empresa: companyId }
  );

  if (!movimientos.length) return [];

  const lineas = await buscarLeer<{
    move_id: unknown;
    product_id: unknown;
    account_id: unknown;
    analytic_distribution: Record<string, number> | false;
  }>(
    "account.move.line",
    [
      ["move_id", "in", movimientos.map((m) => m.id)],
      ["display_type", "=", "product"],
    ],
    ["move_id", "product_id", "account_id", "analytic_distribution"],
    { limite: 500, empresa: companyId }
  );

  const porMovimiento = new Map<number, LineaContabilizada[]>();
  for (const l of lineas) {
    const mid = idDeRelacion(l.move_id);
    if (mid === null) continue;
    if (!porMovimiento.has(mid)) porMovimiento.set(mid, []);
    porMovimiento.get(mid)!.push({
      productoId: idDeRelacion(l.product_id),
      productoNombre: nombreDeRelacion(l.product_id),
      cuentaId: idDeRelacion(l.account_id),
      cuentaNombre: nombreDeRelacion(l.account_id),
      analitica: l.analytic_distribution || null,
    });
  }

  // En el orden en que vinieron: de la más nueva a la más vieja.
  return movimientos.map((m) => ({ lineas: porMovimiento.get(m.id) ?? [] }));
}
