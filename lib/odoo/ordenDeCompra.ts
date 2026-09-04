/**
 * Armar la orden de compra que se le manda a Odoo desde un requerimiento.
 *
 * Es el corazón de la etapa 1 del
 * [spec de facturación](../../docs/superpowers/specs/2026-09-04-facturacion-proveedores-odoo-design.md):
 * si la orden existe en Odoo, contabilidad genera la factura **desde** la orden
 * —con ítems, cantidades y precios ya puestos— en vez de tipearla de cero. Eso
 * es lo que acelera la carga, y por eso el push de la orden se entrega solo,
 * antes de que exista el buzón.
 *
 * Función pura a propósito: no habla con Odoo ni con Supabase. Recibe el
 * requerimiento, la cotización elegida y los enlaces ya resueltos, y devuelve
 * los `vals` exactos. Así lo que se le va a mandar a la contabilidad de otros se
 * puede ver en pantalla y testear sin red antes de mandarlo.
 *
 * Nada de ids fijos en el código: `picking_type_id`, los ids de moneda y el
 * impuesto entran como parámetros. Son de **esta** base de Odoo, y la base tiene
 * el id del build en el nombre.
 */

import { PORCENTAJE_AMBAS, repartirAmbas } from "@/lib/compras/repartoAmbas";

/** Lo que hace falta saber del requerimiento. */
export interface RequerimientoParaOrden {
  nroRi: number;
  descripcion: string;
  codigo: string | null;
  cantidad: number | null;
  /** Empresa del SdG que paga. `null` + `pagaAmbas` = las dos. */
  empresaId: string | null;
  pagaAmbas: boolean;
  fechaNecesidad: string | null;
}

/** La cotización elegida en la comparativa. Es de donde sale el precio. */
export interface CotizacionParaOrden {
  precioUnitario: number | null;
  cantidad: number | null;
  /** Fracción, como lo guarda el SdG: 0.10 es 10%. */
  descuento: number | null;
  costoEnvio: number | null;
  /** `ARS` o `USD`. */
  moneda: string | null;
}

/** Una empresa, con lo que Odoo necesita saber de ella. */
export interface EmpresaParaOrden {
  /** El uuid del SdG. */
  id: string;
  nombre: string;
  /** `res.company` de Odoo, de `empresas.odoo_company_id`. */
  odooCompanyId: number;
  /** El `res.partner` del proveedor **en esta empresa**, de `proveedores_odoo`. */
  odooPartnerId: number | null;
  /** `stock.picking.type` de recepción de esta empresa. */
  pickingTypeId: number;
}

export interface ContextoDeOdoo {
  /** Nombre de moneda → id de `res.currency`. Ej: `{ ARS: 19, USD: 1 }`. */
  monedas: Record<string, number>;
  /**
   * `account.tax` a poner en las líneas, si se decidió cuál.
   *
   * Queda opcional porque es un punto abierto del spec: con descripción libre y
   * sin producto, Odoo no le pone IVA solo, y una factura generada desde una
   * orden sin impuesto sale sin IVA. Mientras no esté resuelto, la orden se crea
   * sin impuesto y eso es visible, no silencioso.
   */
  impuestoId?: number;
  /** Momento de la orden. Se inyecta para que los tests no dependan del reloj. */
  ahora: Date;
}

export interface LineaDeOrden {
  name: string;
  product_qty: number;
  price_unit: number;
  discount?: number;
  taxes_id?: [[6, 0, number[]]];
}

export interface OrdenParaOdoo {
  /** Empresa del SdG, para guardar el vínculo. */
  empresaId: string;
  empresaNombre: string;
  /** 100, o 50 si el requerimiento lo pagan las dos. */
  porcentaje: number;
  /** Lo que se le manda a `purchase.order.create`, tal cual. */
  vals: Record<string, unknown>;
}

export type Problema =
  | { tipo: "sin proveedor enlazado"; empresa: string; detalle: string }
  | { tipo: "sin precio"; detalle: string }
  | { tipo: "sin cantidad"; detalle: string }
  | { tipo: "moneda desconocida"; detalle: string }
  | { tipo: "sin empresa"; detalle: string };

export type ResultadoDeArmado =
  | { ok: true; ordenes: OrdenParaOdoo[] }
  | { ok: false; problemas: Problema[] };

/**
 * Odoo espera los datetime como `YYYY-MM-DD HH:MM:SS`, en UTC y sin zona.
 *
 * `toISOString()` da `2026-09-04T12:30:00.000Z`: la T y la Z de más hacen que
 * Odoo rechace el valor. Se recorta en vez de armarlo a mano para no reinventar
 * el relleno con ceros.
 */
function fechaParaOdoo(fecha: Date): string {
  return fecha.toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Los `vals` de la orden (o los problemas que lo impiden).
 *
 * **Si una empresa no se puede armar, no se arma ninguna.** Un requerimiento
 * AMBAS con el proveedor dado de alta en una sola empresa generaría media
 * compra: una orden por el 50% y la otra mitad en ningún lado. Media compra es
 * peor que ninguna, porque nadie la ve incompleta.
 */
export function armarOrdenes(
  ri: RequerimientoParaOrden,
  cotizacion: CotizacionParaOrden,
  empresas: EmpresaParaOrden[],
  contexto: ContextoDeOdoo
): ResultadoDeArmado {
  const problemas: Problema[] = [];

  const precio = cotizacion.precioUnitario;
  if (precio === null || precio <= 0) {
    problemas.push({
      tipo: "sin precio",
      detalle: `El RI ${ri.nroRi} no tiene precio unitario en la cotización elegida.`,
    });
  }

  // La cantidad puede venir de la cotización o del requerimiento, en ese orden:
  // la de la cotización es la que el proveedor presupuestó de verdad.
  const cantidad = cotizacion.cantidad ?? ri.cantidad;
  if (cantidad === null || cantidad <= 0) {
    problemas.push({
      tipo: "sin cantidad",
      detalle: `El RI ${ri.nroRi} no tiene cantidad ni en la cotización ni en el requerimiento.`,
    });
  }

  const moneda = (cotizacion.moneda ?? "ARS").toUpperCase();
  const monedaId = contexto.monedas[moneda];
  if (!monedaId) {
    problemas.push({
      tipo: "moneda desconocida",
      detalle: `La moneda ${moneda} no existe en Odoo o no está activa.`,
    });
  }

  if (!empresas.length) {
    problemas.push({
      tipo: "sin empresa",
      detalle: `El RI ${ri.nroRi} no tiene empresa definida y tampoco está marcado como AMBAS.`,
    });
  }

  for (const empresa of empresas) {
    if (empresa.odooPartnerId === null) {
      problemas.push({
        tipo: "sin proveedor enlazado",
        empresa: empresa.nombre,
        // El mensaje dice qué hacer, no que algo falló: pasa seguido, porque de
        // los proveedores de Odoo sólo 147 están en las dos empresas.
        detalle:
          `El proveedor del RI ${ri.nroRi} no existe en ${empresa.nombre} dentro de Odoo. ` +
          `Hay que darlo de alta ahí, o revisar su CUIT en el padrón del SdG.`,
      });
    }
  }

  if (problemas.length) return { ok: false, problemas };

  const esCompartido = empresas.length > 1;
  const porcentaje = esCompartido ? PORCENTAJE_AMBAS : 100;

  /*
   * El reparto se calcula **una vez para las dos** y a cada empresa le toca su
   * parte. Darle la misma parte a las dos parece igual y no lo es: con un flete
   * de $100,01 las dos órdenes llevarían $50,01 y sumarían $100,02. Es
   * exactamente el centavo que `repartirAmbas` existe para no inventar.
   */
  const partes = esCompartido
    ? repartirAmbas(cotizacion.costoEnvio ?? 0, cantidad!, porcentaje)
    : null;

  const ordenes = empresas.map((empresa, i) =>
    armarUna(ri, cotizacion, empresa, contexto, {
      precio: precio!,
      monedaId: monedaId!,
      porcentaje,
      esCompartido,
      parte: partes
        ? partes[i]
        : { porcentaje: 100, importe: cotizacion.costoEnvio ?? 0, cantidad: cantidad! },
    })
  );

  return { ok: true, ordenes };
}

function armarUna(
  ri: RequerimientoParaOrden,
  cotizacion: CotizacionParaOrden,
  empresa: EmpresaParaOrden,
  contexto: ContextoDeOdoo,
  calculado: {
    precio: number;
    monedaId: number;
    porcentaje: number;
    esCompartido: boolean;
    /** Lo que le toca a esta empresa: cantidad y flete ya repartidos. */
    parte: { porcentaje: number; importe: number; cantidad: number | null };
  }
): OrdenParaOdoo {
  const { precio, monedaId, porcentaje, esCompartido, parte } = calculado;

  /*
   * En Odoo el importe de una línea no se pone: sale de cantidad × precio. Así
   * que un requerimiento compartido se reparte **por cantidad**, dejando el
   * precio unitario intacto: es la única forma de que las dos órdenes sumen
   * exactamente el total. Puede dar media unidad, y eso es sabido y está
   * documentado en el spec.
   */
  const impuesto: Pick<LineaDeOrden, "taxes_id"> = contexto.impuestoId
    ? { taxes_id: [[6, 0, [contexto.impuestoId]]] }
    : {};

  const lineas: LineaDeOrden[] = [
    {
      // El código del SdG va adelante cuando existe: es lo que permite reconocer
      // el ítem sin abrir el requerimiento.
      name: ri.codigo ? `[${ri.codigo}] ${ri.descripcion}` : ri.descripcion,
      product_qty: parte.cantidad ?? 0,
      price_unit: precio,
      ...(cotizacion.descuento
        ? // El SdG lo guarda como fracción (0.10) y Odoo lo quiere en porcentaje.
          { discount: redondear(cotizacion.descuento * 100, 2) }
        : {}),
      ...impuesto,
    },
  ];

  if (parte.importe > 0) {
    lineas.push({
      name: "Flete",
      product_qty: 1,
      price_unit: parte.importe,
      ...impuesto,
    });
  }

  const vals: Record<string, unknown> = {
    partner_id: empresa.odooPartnerId,
    company_id: empresa.odooCompanyId,
    currency_id: monedaId,
    picking_type_id: empresa.pickingTypeId,
    date_order: fechaParaOdoo(contexto.ahora),
    /*
     * `origin` es el "documento origen" de Odoo, y es el puente entre los dos
     * sistemas para una persona: quien mira la orden ve de qué RI salió sin
     * tener que entrar al SdG. Cuando son dos órdenes lo aclara, porque si no
     * parecen duplicadas.
     */
    origin: esCompartido ? `RI ${ri.nroRi} (${porcentaje}% ${empresa.nombre})` : `RI ${ri.nroRi}`,
    order_line: lineas.map((linea) => [0, 0, linea] as const),
  };

  if (ri.fechaNecesidad) {
    // Odoo lo espera como datetime; la fecha de necesidad es un día.
    vals.date_planned = `${ri.fechaNecesidad} 00:00:00`;
  }

  return {
    empresaId: empresa.id,
    empresaNombre: empresa.nombre,
    porcentaje,
    vals,
  };
}

function redondear(valor: number, decimales: number): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}
