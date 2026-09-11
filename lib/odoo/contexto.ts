/**
 * Resolver, contra Odoo, los ids que hacen falta para crear una orden.
 *
 * Nada de esto va fijo en el código, y no es purismo: los ids son de **esta**
 * base de Odoo. El grupo tiene producción y staging, la base de producción lleva
 * el id del build en el nombre, y un restore desde otra instancia cambiaría todo.
 * Un `4` escrito en el código sería un impuesto correcto hoy y una contabilidad
 * equivocada mañana, sin que nada avise.
 *
 * Todo se busca por **nombre exacto**, nunca aproximado. Si no está o hay más de
 * uno, se informa y no se crea la orden. Elegir "el que se le parece" es el error
 * que no se nota nunca.
 */

import { buscarLeer, idDeRelacion } from "./client";

/**
 * El producto genérico de las líneas.
 *
 * `purchase.order.line` exige `product_id` por una restricción SQL del modelo,
 * aunque `fields_get` diga que no. La descripción del requerimiento va en el
 * `name` de la línea —que es lo que se ve e imprime—; el producto sólo aporta
 * cuenta y unidad. El grupo ya tenía este creado, sin empresa, o sea compartido.
 */
const NOMBRE_PRODUCTO_GENERICO = "ART. VARIOS";

/**
 * El producto de la línea de flete.
 *
 * Antes también era `ART. VARIOS`. El grupo ya tiene uno hecho —`FLETE`—, así
 * que la línea del envío deja de mezclarse con el resto del gasto. No hay nada
 * que decidir acá: es determinístico, a diferencia del producto del ítem.
 */
const NOMBRE_PRODUCTO_FLETE = "FLETE";

/**
 * El impuesto de las líneas.
 *
 * Es el que usan: 343 de las últimas 400 líneas de orden. Pertenece a una
 * empresa —id 4 en Polcecal, 73 en Polysan—, así que se busca uno por empresa.
 * Las excepciones (0%, exento, no gravado) las corrige contabilidad en el
 * borrador.
 */
const NOMBRE_IMPUESTO = "IVA Compras 21%";

export interface DatosDeEmpresaOdoo {
  pickingTypeId: number;
  impuestoId: number;
}

export interface ContextoResuelto {
  monedas: Record<string, number>;
  productoGenericoId: number;
  uomId: number;
  /**
   * El producto de flete. `null` si no está en el catálogo: ahí la línea usa
   * el genérico, como antes, en vez de no poder crear la orden por un producto
   * de más.
   */
  fleteId: number | null;
  /** Por id de `res.company`. */
  porEmpresa: Record<number, DatosDeEmpresaOdoo>;
}

export type ResultadoDeContexto =
  | { ok: true; contexto: ContextoResuelto }
  | { ok: false; problemas: string[] };

export async function resolverContextoDeOdoo(
  companyIds: number[]
): Promise<ResultadoDeContexto> {
  const problemas: string[] = [];

  const [monedasCrudas, productos, flete, pickings, impuestos] = await Promise.all([
    buscarLeer<{ id: number; name: string }>(
      "res.currency",
      [["name", "in", ["ARS", "USD"]]],
      ["name"],
      { limite: 10, contexto: { active_test: false } }
    ),
    buscarLeer<{ id: number; name: string; uom_po_id: unknown }>(
      "product.product",
      [
        ["name", "=", NOMBRE_PRODUCTO_GENERICO],
        ["purchase_ok", "=", true],
      ],
      ["name", "uom_po_id"],
      { limite: 5 }
    ),
    buscarLeer<{ id: number; name: string }>(
      "product.product",
      [
        ["name", "=", NOMBRE_PRODUCTO_FLETE],
        ["purchase_ok", "=", true],
      ],
      ["name"],
      { limite: 5 }
    ),
    buscarLeer<{ id: number; company_id: unknown }>(
      "stock.picking.type",
      [
        ["code", "=", "incoming"],
        ["company_id", "in", companyIds],
      ],
      ["name", "company_id"],
      { limite: 20, orden: "id asc" }
    ),
    buscarLeer<{ id: number; company_id: unknown }>(
      "account.tax",
      [
        ["name", "=", NOMBRE_IMPUESTO],
        ["type_tax_use", "=", "purchase"],
        ["company_id", "in", companyIds],
      ],
      ["name", "company_id"],
      { limite: 20, orden: "id asc" }
    ),
  ]);

  const monedas: Record<string, number> = {};
  for (const m of monedasCrudas) monedas[m.name] = m.id;
  if (!monedas.ARS) problemas.push("Odoo no tiene la moneda ARS activa.");

  if (productos.length !== 1) {
    problemas.push(
      `Se esperaba un solo producto llamado "${NOMBRE_PRODUCTO_GENERICO}" y hay ${productos.length}. ` +
        `Las líneas de la orden lo necesitan: sin eso Odoo rechaza la orden entera.`
    );
  }
  const uomId = productos.length === 1 ? idDeRelacion(productos[0].uom_po_id) : null;
  if (productos.length === 1 && uomId === null) {
    problemas.push(`El producto "${NOMBRE_PRODUCTO_GENERICO}" no tiene unidad de compra.`);
  }

  /*
   * A diferencia del genérico, que la línea sí necesita para existir, que
   * falte el producto de flete no bloquea la orden: degrada al genérico, que
   * es lo que pasaba antes de esta tarea. Fallar la orden entera por un
   * producto de más sería peor que lo que hay hoy.
   */
  const fleteId = flete.length === 1 ? flete[0].id : null;

  /*
   * Se toma el primero por id de cada empresa. Hoy hay uno solo por empresa —los
   * 2.295 pedidos existentes usan el 1 en Polcecal y el 8 en Polysan—, pero si
   * mañana hay dos depósitos, esto elige el más viejo en vez de fallar. Es
   * preferible: una orden en el depósito equivocado se corrige, una orden que no
   * se creó frena la compra.
   */
  const porEmpresa: Record<number, DatosDeEmpresaOdoo> = {};
  for (const companyId of companyIds) {
    const picking = pickings.find((p) => idDeRelacion(p.company_id) === companyId);
    const impuesto = impuestos.find((t) => idDeRelacion(t.company_id) === companyId);

    if (!picking) {
      problemas.push(`La empresa ${companyId} de Odoo no tiene un tipo de operación de recepción.`);
    }
    if (!impuesto) {
      problemas.push(
        `La empresa ${companyId} de Odoo no tiene un impuesto "${NOMBRE_IMPUESTO}" de compras. ` +
          `Sin impuesto, la factura que se genere desde la orden saldría sin IVA.`
      );
    }
    if (picking && impuesto) {
      porEmpresa[companyId] = { pickingTypeId: picking.id, impuestoId: impuesto.id };
    }
  }

  if (problemas.length) return { ok: false, problemas };

  return {
    ok: true,
    contexto: {
      monedas,
      productoGenericoId: productos[0].id,
      uomId: uomId!,
      fleteId,
      porEmpresa,
    },
  };
}

// ── El contexto de las facturas de proveedor ─────────────────

export interface DatosDeEmpresaParaFacturas {
  diarioId: number;
  /** El IVA 21% de compras de esa empresa. `null` si no lo tiene configurado. */
  impuestoId: number | null;
}

export interface ContextoDeFacturas {
  monedas: Record<string, number>;
  porEmpresa: Record<number, DatosDeEmpresaParaFacturas>;
}

export type ResultadoDeContextoDeFacturas =
  | { ok: true; contexto: ContextoDeFacturas }
  | { ok: false; problemas: string[] };

/**
 * Los ids que necesita un borrador de factura de proveedor.
 *
 * Es el gemelo de `resolverContextoDeOdoo` para el otro lado del circuito, y por
 * los mismos motivos: nada va fijo en el código, todo se busca por nombre exacto
 * y si falta se informa en vez de elegir algo parecido.
 *
 * Dos diferencias con el de las órdenes de compra, y las dos salen de haberlo
 * medido contra la instancia real:
 *
 * - **No hace falta producto.** `account.move.line` no tiene la restricción SQL
 *   que obliga a `product_id` en `purchase.order.line`: la línea se crea con
 *   nombre y precio, y Odoo resuelve la cuenta de gasto por el proveedor.
 * - **El diario sí hace falta y es por empresa**: el `BILL` de Polcecal es el 11
 *   y el de Polysan el 23. Dejarlo implícito haría que la factura caiga en el
 *   diario de la empresa por defecto del usuario bot.
 */
export async function resolverContextoDeFacturas(
  companyIds: number[]
): Promise<ResultadoDeContextoDeFacturas> {
  const problemas: string[] = [];

  const [monedasCrudas, diarios, impuestos] = await Promise.all([
    buscarLeer<{ id: number; name: string }>(
      "res.currency",
      [["name", "in", ["ARS", "USD"]]],
      ["name"],
      { limite: 10, contexto: { active_test: false } }
    ),
    buscarLeer<{ id: number; company_id: unknown }>(
      "account.journal",
      [
        ["type", "=", "purchase"],
        ["company_id", "in", companyIds],
      ],
      ["name", "company_id"],
      { limite: 20, orden: "id asc" }
    ),
    buscarLeer<{ id: number; company_id: unknown }>(
      "account.tax",
      [
        ["name", "=", NOMBRE_IMPUESTO],
        ["type_tax_use", "=", "purchase"],
        ["company_id", "in", companyIds],
      ],
      ["name", "company_id"],
      { limite: 20, orden: "id asc" }
    ),
  ]);

  const monedas: Record<string, number> = {};
  for (const m of monedasCrudas) monedas[m.name] = m.id;
  if (!monedas.ARS) problemas.push("Odoo no tiene la moneda ARS activa.");

  const porEmpresa: Record<number, DatosDeEmpresaParaFacturas> = {};
  for (const companyId of companyIds) {
    const diario = diarios.find((d) => idDeRelacion(d.company_id) === companyId);
    const impuesto = impuestos.find((t) => idDeRelacion(t.company_id) === companyId);

    if (!diario) {
      problemas.push(
        `La empresa ${companyId} de Odoo no tiene un diario de compras donde poner la factura.`
      );
      continue;
    }
    /*
     * Que falte el impuesto no frena nada: una factura C no lo lleva, y una A
     * sin impuesto es un borrador al que contabilidad le agrega el IVA, que es
     * mejor que no tener el borrador. Se informa arriba, en el push.
     */
    porEmpresa[companyId] = { diarioId: diario.id, impuestoId: impuesto?.id ?? null };
  }

  if (problemas.length) return { ok: false, problemas };

  return { ok: true, contexto: { monedas, porEmpresa } };
}
