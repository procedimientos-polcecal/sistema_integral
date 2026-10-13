import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarLeer } from "@/lib/odoo/client";
import { hoyEnArgentina, sumarDias } from "@/lib/core/fechas";
import { movimientoDesdeLaLineaDeOdoo, type Catalogos, type LineaDeOdoo } from "./reconocer";
import { traerCarbonilleros, traerMovimientos, traerProductosDeOdoo } from "./consultas";
import {
  desviosContraOdoo,
  type CamionDelLibro,
  type Desvios,
  type LineaDeOdooParaControl,
} from "./conciliacion";

/**
 * El libro contra Odoo: qué camión no tiene orden de compra.
 *
 * **Odoo dejó de crear movimientos el 13/10/2026.** La planilla manda sobre el
 * libro —ver `desdeLaPlanilla.ts`— y esto pasó a ser el único lugar que avisa
 * que un camión entró sin orden de compra, que es plata que después no se puede
 * facturar.
 *
 * LA VENTANA SIGUE SIENDO `create_date` Y NO `date_order`, por la misma razón
 * de siempre: una orden fechada el 05/09 y cargada el 20/09 la ventana por
 * fecha de orden no la ve nunca. Se midió sobre un año: 1.053 de 1.055 órdenes
 * se cargan el mismo día, pero el máximo son 3 y el 16/09 Odoo llevaba once sin
 * cargar.
 *
 * **No inserta ni borra nada.** Devuelve los desvíos y quien llama decide qué
 * mostrar. Guardarlos sería el error que este módulo ya tiene escrito para los
 * saldos: un derivado guardado se desincroniza y nada avisa.
 *
 * Spec: docs/superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md
 */

const DIAS_DE_MARGEN = 30;

export interface ResumenDelControl extends Desvios {
  /** Cuántas líneas de Odoo se miraron. */
  leidas: number;
}

export async function controlarContraOdoo(
  supabase: SupabaseClient
): Promise<ResumenDelControl> {
  const vacio: ResumenDelControl = {
    leidas: 0,
    sinOrden: [],
    sinCamion: [],
    cantidadDistinta: [],
  };

  const [carbonilleros, productos] = await Promise.all([
    traerCarbonilleros(supabase),
    traerProductosDeOdoo(supabase),
  ]);

  // Sin carbonilleros declarados no hay a quién buscarle órdenes. No es un
  // error: es el catálogo sin cargar.
  const activos = carbonilleros.filter((c) => c.activo);
  if (activos.length === 0) return vacio;

  const catalogos: Catalogos = {
    carbonilleros: new Map(
      activos.map((c) => [
        c.odoo_partner_id,
        { id: c.id, carbon: c.carbon, proveedorId: c.proveedor_id },
      ])
    ),
    productos: new Map(productos.map((p) => [p.odoo_product_id, p.cuenta])),
  };

  const desde = sumarDias(hoyEnArgentina(), -DIAS_DE_MARGEN);

  const crudas = await buscarLeer<{
    id: number;
    order_id: [number, string];
    product_id: [number, string];
    partner_id: [number, string];
    product_qty: number;
  }>(
    "purchase.order.line",
    [
      ["order_id.state", "=", "purchase"],
      ["order_id.partner_id", "in", activos.map((c) => c.odoo_partner_id)],
      ["create_date", ">=", `${desde} 00:00:00`],
    ],
    ["id", "order_id", "product_id", "partner_id", "product_qty"],
    { limite: 2000 }
  );
  if (crudas.length === 0) return vacio;

  const ordenIds = [...new Set(crudas.map((l) => l.order_id[0]))];
  const ordenes = await buscarLeer<{ id: number; date_order: string }>(
    "purchase.order",
    [["id", "in", ordenIds]],
    ["id", "date_order"],
    { limite: 2000 }
  );
  const fechaDeOrden = new Map(ordenes.map((o) => [o.id, String(o.date_order).slice(0, 10)]));

  // `movimientoDesdeLaLineaDeOdoo` se usa SÓLO para separar los camiones de los
  // fletes y de lo que no se reconoce. Lo que devuelve ya no se guarda: su
  // `movimiento` se descarta.
  const deOdoo: LineaDeOdooParaControl[] = [];
  for (const l of crudas) {
    const linea: LineaDeOdoo = {
      id: l.id,
      ordenNombre: l.order_id[1],
      fecha: fechaDeOrden.get(l.order_id[0]) ?? "",
      partnerId: l.partner_id[0],
      partnerNombre: l.partner_id[1],
      productoId: l.product_id[0],
      productoNombre: l.product_id[1],
      cantidad: l.product_qty,
    };
    if (!linea.fecha) continue;
    if (movimientoDesdeLaLineaDeOdoo(linea, catalogos).resultado !== "entra") continue;
    deOdoo.push({
      ordenNombre: linea.ordenNombre,
      fecha: linea.fecha,
      partnerId: linea.partnerId,
      partnerNombre: linea.partnerNombre,
      cantidad: linea.cantidad,
    });
  }

  // Los camiones del libro del mismo período. Salen de la planilla, que es
  // ahora la fuente.
  const partnerDelCarbonillero = new Map(activos.map((c) => [c.id, c.odoo_partner_id]));
  const camiones: CamionDelLibro[] = (await traerMovimientos(supabase))
    .filter(
      (m) =>
        m.tipo === "entrada" &&
        m.fecha >= desde &&
        m.carbonillero_id !== null &&
        partnerDelCarbonillero.has(m.carbonillero_id)
    )
    .map((m) => ({
      id: m.id,
      fecha: m.fecha,
      odooPartnerId: partnerDelCarbonillero.get(m.carbonillero_id as string) as number,
      toneladas: Math.abs(Number(m.toneladas)),
    }));

  return { leidas: crudas.length, ...desviosContraOdoo(camiones, deOdoo) };
}
