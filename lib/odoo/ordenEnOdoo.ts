import { buscarLeer } from "./client";
import { leerEstado, type EstadoDeOrden } from "./estadoDeOrden";

/**
 * Qué dice una orden de compra en Odoo, no sólo en qué estado está.
 *
 * ## Por qué
 *
 * La ficha del requerimiento mostraba de cada orden el número, la empresa y una
 * palabra de estado. Con eso no se puede contestar ninguna de las tres
 * preguntas que alguien se hace mirando una orden ya creada: **qué se le pidió,
 * a quién, y en qué quedó.** Para verlo había que abrir Odoo.
 *
 * Y la orden **se edita del otro lado**: contabilidad le cambia el precio, el
 * producto o la cantidad, y de este lado no se notaba. Ésa es la divergencia
 * que este sistema persigue en todos lados — un dato que dejó de coincidir y
 * nada avisa.
 *
 * ## No cuesta un viaje más
 *
 * El estado ya se leía con una llamada a `purchase.order`, pidiendo **un solo
 * campo**. Pedir los quince que hacen falta sale lo mismo: lo que se paga en
 * Odoo Online es el viaje, no los campos. Las líneas sí son una segunda
 * llamada, pero una sola para todas las órdenes juntas —una ficha de RI
 * compartido tiene dos— por la misma razón por la que `estadosDeLasOrdenes`
 * las preguntaba juntas.
 *
 * ## Lo que no se guarda
 *
 * Nada de esto. La orden vive en Odoo y ahí la cambia cualquiera; una copia
 * nuestra empezaría a mentir el primer día, que es exactamente el argumento por
 * el que el estado tampoco se guardaba. Se lee cada vez que se abre la ficha.
 */

/** Una línea de la orden, como se la muestra. */
export interface LineaDeOrden {
  id: number;
  /** La descripción que viajó del RI. */
  descripcion: string;
  /** El producto de Odoo. `ART. VARIOS` cuando nadie eligió uno. */
  producto: string | null;
  cantidad: number;
  unidad: string | null;
  precioUnitario: number;
  subtotal: number;
  /** Cuánto llegó. Es lo que dice si el remito se movió. */
  recibido: number;
  /** Cuánto se facturó, que es para lo que la orden existe. */
  facturado: number;
}

export interface OrdenLeida {
  odooOrderId: number;
  nombre: string | null;
  estado: EstadoDeOrden;
  /** El partner de Odoo. **No** es el proveedor del SdG: ver abajo. */
  proveedor: string | null;
  fecha: string | null;
  moneda: string | null;
  neto: number;
  iva: number;
  total: number;
  /**
   * Qué dice Odoo del avance de la facturación: `no`, `to invoice`, `invoiced`.
   * Es el dato que contesta "¿sirvió de algo haber creado la orden?".
   */
  facturacion: string | null;
  lineas: LineaDeOrden[];
}

interface FilaDeOrden {
  id: number;
  name: string | false;
  state: string | false;
  partner_id: [number, string] | false;
  date_order: string | false;
  currency_id: [number, string] | false;
  amount_untaxed: number;
  amount_tax: number;
  amount_total: number;
  invoice_status: string | false;
  order_line: number[];
}

interface FilaDeLinea {
  id: number;
  order_id: [number, string] | false;
  name: string | false;
  product_id: [number, string] | false;
  product_qty: number;
  product_uom: [number, string] | false;
  price_unit: number;
  price_subtotal: number;
  qty_received: number;
  qty_invoiced: number;
}

/** Odoo devuelve `false` donde no hay valor, y `false` no es un texto vacío. */
const texto = (v: string | false | null | undefined): string | null =>
  typeof v === "string" && v !== "" ? v : null;

/**
 * Las fechas de Odoo son UTC y **no lo dicen**: `"2026-09-09 19:38:50"`, con un
 * espacio y sin zona. Formatear eso directamente lo interpreta como hora local
 * y corre el día en cualquier orden creada antes de las 3 de la mañana UTC.
 *
 * Es la misma trampa que ya dio vuelta 885 fechas en Compras, por otro lado. Se
 * normaliza acá —donde se sabe que el dato viene de Odoo— y no en la pantalla,
 * que después puede usar `fecha()` de `constants.ts` sin pensarlo.
 */
function instante(v: string | false | null | undefined): string | null {
  const t = texto(v);
  return t ? `${t.replace(" ", "T")}Z` : null;
}

const nombreDe = (v: [number, string] | false): string | null => (v ? v[1] : null);

/**
 * Las órdenes con todo lo que la pantalla muestra, en dos llamadas.
 *
 * Una orden que no vuelve es una orden que **ya no está en Odoo** —la
 * borraron—, y eso es un dato: no aparece en el resultado, igual que hacía
 * `estadosDeLasOrdenes`. Quien llama decide qué mostrar en su lugar.
 */
export async function traerLasOrdenes(ids: number[]): Promise<Map<number, OrdenLeida>> {
  if (!ids.length) return new Map();

  const ordenes = await buscarLeer<FilaDeOrden>(
    "purchase.order",
    [["id", "in", ids]],
    [
      "name",
      "state",
      "partner_id",
      "date_order",
      "currency_id",
      "amount_untaxed",
      "amount_tax",
      "amount_total",
      "invoice_status",
      "order_line",
    ],
    { limite: ids.length }
  );

  const idsDeLinea = ordenes.flatMap((o) => o.order_line ?? []);
  const lineas = idsDeLinea.length
    ? await buscarLeer<FilaDeLinea>(
        "purchase.order.line",
        [["id", "in", idsDeLinea]],
        [
          "order_id",
          "name",
          "product_id",
          "product_qty",
          "product_uom",
          "price_unit",
          "price_subtotal",
          "qty_received",
          "qty_invoiced",
        ],
        { limite: idsDeLinea.length }
      )
    : [];

  const porOrden = new Map<number, LineaDeOrden[]>();
  for (const l of lineas) {
    const orden = l.order_id ? l.order_id[0] : null;
    if (orden === null) continue;

    const lista = porOrden.get(orden) ?? [];
    lista.push({
      id: l.id,
      descripcion: texto(l.name) ?? "",
      producto: nombreDe(l.product_id),
      cantidad: l.product_qty ?? 0,
      unidad: nombreDe(l.product_uom),
      precioUnitario: l.price_unit ?? 0,
      subtotal: l.price_subtotal ?? 0,
      recibido: l.qty_received ?? 0,
      facturado: l.qty_invoiced ?? 0,
    });
    porOrden.set(orden, lista);
  }

  return new Map(
    ordenes.map((o) => [
      o.id,
      {
        odooOrderId: o.id,
        nombre: texto(o.name),
        estado: leerEstado(texto(o.state)),
        proveedor: nombreDe(o.partner_id),
        fecha: instante(o.date_order),
        moneda: nombreDe(o.currency_id),
        neto: o.amount_untaxed ?? 0,
        iva: o.amount_tax ?? 0,
        total: o.amount_total ?? 0,
        facturacion: texto(o.invoice_status),
        lineas: porOrden.get(o.id) ?? [],
      },
    ])
  );
}
