/**
 * Los `vals` de la orden de compra que sale de una recepción.
 *
 * Función pura a propósito, como `lib/odoo/ordenDeCompra.ts`: no habla con Odoo
 * ni con Supabase. Recibe los ids ya resueltos y devuelve exactamente lo que se
 * le va a mandar, así lo que entra a la contabilidad de otros se puede ver en
 * pantalla y probar sin red.
 *
 * Spec: docs/superpowers/specs/2026-09-11-despacho-recepcion-de-carbonilla-design.md
 */

/**
 * El precio que lleva la línea.
 *
 * **Es simbólico y eso es el circuito, no un olvido.** Se midió contra un año de
 * Odoo: de las órdenes de carbonilla sin facturar, 287 tienen precio ≤ $2 y 3
 * tienen precio real; de las facturadas, 190 real y 97 simbólico. O sea que el
 * precio no se sabe cuando el camión está en la balanza y aparece cuando llega
 * la factura, que es la que reprecia la orden.
 *
 * Va $1 porque es el valor más usado del año (212 líneas contra 56 de $2) y
 * porque un peso por tonelada no se confunde nunca con un precio de verdad.
 */
export const PRECIO_SIMBOLICO = 1;

export interface DatosDeLaOrdenDeRecepcion {
  /** El partner de Odoo del proveedor, resuelto **por empresa**. */
  odooPartnerId: number;
  odooCompanyId: number;
  pickingTypeId: number;
  /** El producto que le corresponde a este proveedor, elegido por id y no por nombre. */
  productoId: number;
  /** La unidad. Se resuelve `Toneladas` por nombre exacto contra esta base. */
  uomId: number;
  /** El IVA de la empresa. Null es válido: la orden sale sin impuesto. */
  impuestoId: number | null;
  monedaId: number | null;
  /** El neto pesado, en toneladas. */
  toneladas: number;
  /** La fecha de la recepción, `YYYY-MM-DD`. */
  fecha: string;
  /** Qué se recibió, como se ve en la línea. */
  descripcion: string;
  /** El "documento origen" de Odoo: el puente entre los dos sistemas, para una persona. */
  origen: string;
}

/** Odoo quiere `YYYY-MM-DD HH:MM:SS` en UTC. La recepción es de un día, no de un instante. */
function fechaParaOdoo(fecha: string): string {
  return `${fecha} 12:00:00`;
}

/**
 * Los valores exactos de la orden.
 *
 * **Una sola línea.** Se midió: 570 de las 577 órdenes de carbonilla del año la
 * tienen, y las 7 restantes llevan un `FLETE` aparte que este módulo no arma —
 * si alguna vez hace falta, se agrega en Odoo a mano.
 */
export function valoresDeLaOrdenDeRecepcion(
  d: DatosDeLaOrdenDeRecepcion
): Record<string, unknown> {
  const linea: Record<string, unknown> = {
    product_id: d.productoId,
    name: d.descripcion,
    product_qty: d.toneladas,
    // La unidad va explícita y siempre la misma. Hoy conviven dos para la misma
    // cosa —441 líneas en Toneladas y 136 en "Unidades"—, y esa mezcla es lo que
    // hace que un total del mes no se pueda sumar sin mirar fila por fila.
    product_uom: d.uomId,
    price_unit: PRECIO_SIMBOLICO,
    // Odoo exige `date_planned` en toda línea: la del día de la recepción, que
    // ya ocurrió. No hay ninguna fecha futura que prometer.
    date_planned: fechaParaOdoo(d.fecha),
    taxes_id: [[6, 0, d.impuestoId === null ? [] : [d.impuestoId]]],
  };

  return {
    partner_id: d.odooPartnerId,
    company_id: d.odooCompanyId,
    picking_type_id: d.pickingTypeId,
    date_order: fechaParaOdoo(d.fecha),
    ...(d.monedaId === null ? {} : { currency_id: d.monedaId }),
    origin: d.origen,
    order_line: [[0, 0, linea]],
  };
}

/**
 * El texto del "documento origen", que es lo que ve quien abre la orden en Odoo.
 *
 * Dice de dónde salió y con qué pesaje, porque ése es el dato que no está en
 * ningún otro lado: si alguien discute la cantidad, el bruto y la tara están acá
 * sin tener que entrar al SdG.
 */
export function origenDeLaRecepcion(datos: {
  fecha: string;
  brutoKg: number;
  taraKg: number;
}): string {
  const [a, m, d] = datos.fecha.split("-");
  return `Recepción SdG ${Number(d)}/${Number(m)}/${a} · bruto ${datos.brutoKg} kg − tara ${datos.taraKg} kg`;
}
