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

/**
 * De dónde sale el precio de la orden.
 *
 * Hay **dos caminos** y los dos son válidos, porque así trabaja el grupo:
 *
 *  - el **presupuesto elegido** en la comparativa, que trae el unitario neto; o
 *  - el **costo que carga el encargado de compras** en Gestión de compra, del
 *    que `precioDesdeElRequerimiento` saca el neto (ese campo es el total con
 *    IVA). Es el camino habitual: Maxi o Nico aprueban y le informan la
 *    elección, y el encargado la registra al pasar el pedido a *pedido*.
 *
 * Exigir el presupuesto elegido dejaba la orden sin generarse nunca.
 */
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
  /**
   * El `account.tax` de IVA Compras 21% **de esta empresa**.
   *
   * Va por empresa porque en Odoo los impuestos pertenecen a una: el mismo "IVA
   * Compras 21%" es el id 4 en Polcecal y el 73 en Polysan. Usar el de la otra
   * empresa no da un error prolijo, da un asiento en la contabilidad equivocada.
   *
   * Es 21% porque es lo que usan: 343 de las últimas 400 líneas de orden. Las
   * excepciones (0%, exento, no gravado) las corrige contabilidad en el
   * borrador, que es exactamente para lo que el borrador existe.
   */
  impuestoId: number | null;
}

export interface ContextoDeOdoo {
  /** Nombre de moneda → id de `res.currency`. Ej: `{ ARS: 19, USD: 1 }`. */
  monedas: Record<string, number>;
  /**
   * El producto genérico que llevan las líneas, y su unidad de medida.
   *
   * Hace falta aunque parezca que no. `fields_get` dice que `product_id` no es
   * obligatorio en `purchase.order.line`, y **es mentira**: hay una restricción
   * SQL del modelo —`accountable_required_fields`— que exige `product_id`,
   * `product_uom` y `date_planned` en toda línea facturable. Se descubrió
   * intentando crear una orden en staging: "Missing required fields on
   * accountable purchase order line".
   *
   * No hace falta mapear el catálogo igual: la descripción del requerimiento va
   * en el `name` de la línea, que es lo que se ve e imprime, y el producto sólo
   * aporta cuenta y unidad. El grupo ya tiene uno hecho para esto —`ART. VARIOS`,
   * sin empresa, o sea compartido por las dos—, así que no se inventa nada.
   */
  productoGenericoId: number;
  uomId: number;
  /**
   * El producto de la línea de flete. `null` si no está en el catálogo de
   * Odoo: ahí la línea usa el genérico, como antes, en vez de no poder crear
   * la orden por un producto de más.
   */
  fleteId: number | null;
  /** Momento de la orden. Se inyecta para que los tests no dependan del reloj. */
  ahora: Date;
}

export interface LineaDeOrden {
  product_id: number;
  product_uom: number;
  date_planned: string;
  name: string;
  product_qty: number;
  price_unit: number;
  taxes_id: [[6, 0, number[]]];
  discount?: number;
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
  | { tipo: "sin impuesto"; empresa: string; detalle: string }
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
  contexto: ContextoDeOdoo,
  /**
   * El producto que Compras confirmó para el ítem. Sin él, el genérico: una
   * pantalla vieja que no lo manda sigue creando la orden como antes.
   */
  producto?: { id: number; uomId: number | null }
): ResultadoDeArmado {
  const problemas: Problema[] = [];

  const precio = cotizacion.precioUnitario;
  if (precio === null || precio <= 0) {
    problemas.push({
      tipo: "sin precio",
      detalle: `El RI ${ri.nroRi} no tiene precio: falta el presupuesto elegido o el costo + IVA.`,
    });
  }

  // La cantidad puede venir de la cotización o del requerimiento, en ese orden:
  // la de la cotización es la que el proveedor presupuestó de verdad.
  const cantidad = cotizacion.cantidad ?? ri.cantidad;
  if (cantidad === null || cantidad <= 0) {
    problemas.push({
      tipo: "sin cantidad",
      detalle: `El RI ${ri.nroRi} no tiene cantidad ni en el presupuesto ni en el requerimiento.`,
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

    /*
     * Sin impuesto no se crea la orden, y es a propósito: una orden sin IVA
     * genera una factura sin IVA, y eso es peor que no tener la orden. El punto
     * de todo esto es que la factura salga completa desde la orden.
     */
    if (empresa.impuestoId === null) {
      problemas.push({
        tipo: "sin impuesto",
        empresa: empresa.nombre,
        detalle:
          `No se pudo resolver el IVA Compras 21% de ${empresa.nombre} en Odoo. ` +
          `Sin impuesto, la factura que se genere desde la orden saldría sin IVA.`,
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
    armarUna(
      ri,
      cotizacion,
      empresa,
      contexto,
      {
        precio: precio!,
        monedaId: monedaId!,
        porcentaje,
        esCompartido,
        parte: partes
          ? partes[i]
          : { porcentaje: 100, importe: cotizacion.costoEnvio ?? 0, cantidad: cantidad! },
      },
      producto
    )
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
  },
  /** El producto que Compras confirmó. Sin él, el genérico. */
  producto?: { id: number; uomId: number | null }
): OrdenParaOdoo {
  const { precio, monedaId, porcentaje, esCompartido, parte } = calculado;

  /*
   * En Odoo el importe de una línea no se pone: sale de cantidad × precio. Así
   * que un requerimiento compartido se reparte **por cantidad**, dejando el
   * precio unitario intacto: es la única forma de que las dos órdenes sumen
   * exactamente el total. Puede dar media unidad, y eso es sabido y está
   * documentado en el spec.
   */
  /**
   * Los tres campos que la restricción SQL de Odoo exige en toda línea, más el
   * impuesto de esta empresa. Van en las dos líneas igual.
   */
  const obligatorios = {
    product_id: producto?.id ?? contexto.productoGenericoId,
    // La unidad es la del producto elegido. Hoy las 378 comprables son todas
    // `Unidades`, así que no cambia nada; el día que alguien cargue un
    // producto en kilos, Odoo rechaza la línea si la unidad no es la de su
    // categoría.
    product_uom: producto?.uomId ?? contexto.uomId,
    // La línea también exige `date_planned`. Si el RI no tiene fecha de
    // necesidad, la de la orden: no hay razón para prometer una fecha inventada.
    date_planned: ri.fechaNecesidad
      ? `${ri.fechaNecesidad} 00:00:00`
      : fechaParaOdoo(contexto.ahora),
    taxes_id: [[6, 0, [empresa.impuestoId!]]] as [[6, 0, number[]]],
  };

  const lineas: LineaDeOrden[] = [
    {
      ...obligatorios,
      // El código del SdG va adelante cuando existe: es lo que permite reconocer
      // el ítem sin abrir el requerimiento.
      name: ri.codigo ? `[${ri.codigo}] ${ri.descripcion}` : ri.descripcion,
      product_qty: parte.cantidad ?? 0,
      price_unit: precio,
      ...(cotizacion.descuento
        ? // El SdG lo guarda como fracción (0.10) y Odoo lo quiere en porcentaje.
          { discount: redondear(cotizacion.descuento * 100, 2) }
        : {}),
    },
  ];

  if (parte.importe > 0) {
    lineas.push({
      ...obligatorios,
      // El flete tiene su propio producto en el catálogo: no comparte cuenta
      // contable con el ítem. Si no está en el catálogo, el genérico, que es
      // lo que pasaba antes.
      product_id: contexto.fleteId ?? contexto.productoGenericoId,
      product_uom: contexto.uomId,
      name: "Flete",
      product_qty: 1,
      price_unit: parte.importe,
      /*
       * El flete va **sin IVA**, y no es un olvido: la fórmula de la comparativa
       * es `neto * (1 + IVA) − descuento + envío`, o sea que suma el envío
       * después del impuesto. Gravarlo acá haría que la orden totalice un 21%
       * del flete más que la compra que se aprobó.
       */
      taxes_id: [[6, 0, []]],
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

  /*
   * La orden **no** lleva `date_planned`: en Odoo 17 el de la cabecera se
   * calcula a partir de las líneas. La fecha de necesidad va en cada línea, que
   * además la exige. Mandar un campo calculado es pedirle a Odoo que lo ignore,
   * o que se queje; lo que se probó en staging fue esto.
   */

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
