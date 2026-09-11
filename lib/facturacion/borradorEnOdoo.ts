import { discriminaIva, esNotaDeCredito, nombreDelComprobante, numeroFormateado } from "./comprobante";

/**
 * Armar el borrador de factura de proveedor que se crea en Odoo.
 *
 * Es la segunda mitad de "el SdG propone, Odoo confirma": el buzón ya sabe
 * emisor, número, fecha e importe sin que nadie los tipee, así que lo que falta
 * es dejar eso escrito del lado de contabilidad **en borrador**, para que la
 * carga sea revisar y postear en vez de transcribir.
 *
 * Acá no hay red: son los `vals` y nada más, para poder probarlos sin Odoo. El
 * viaje vive en `lib/odoo/pushFactura.ts`.
 *
 * ## El Odoo del grupo tiene una localización argentina propia (11/09/2026)
 *
 * No es la estándar —`l10n_latam.document.type` no existe— sino un juego de
 * módulos propios (`odoo_l10n_ar`), y eso **decide todo lo de abajo**. Se
 * descubrió de la peor manera útil: creando un borrador que se veía perfecto y
 * que al postearlo murió con *"El documento no tiene numero!"*.
 *
 * Los campos que importan en `account.move`:
 *
 * | Campo | Qué es | Cargado en |
 * |---|---|---|
 * | `voucher_type_id` | El tipo de comprobante. Su `code` **es el número de ARCA**, el mismo que trae el QR | 6.414 de 6.423 |
 * | `voucher_name` | El número, `0006-00010192` | 6.412 de 6.423 |
 * | `full_voucher_name` | `FC A 0006-00010192`, que lo calcula Odoo | — |
 *
 * Dos consecuencias:
 *
 * 1. **Sin esos dos campos el borrador no se puede postear**, o sea que no sirve
 *    de nada: contabilidad tendría que completarlo igual. Con ellos sí —probado
 *    creando y posteando una factura de verdad en staging, y borrándola—.
 * 2. **El número del comprobante tiene un campo propio y está en el 99,8% de las
 *    facturas.** Por eso la conciliación cruza `voucher_name` y no la referencia
 *    de texto libre, que está en el 24% y se repite.
 *
 * `ref` queda **sin tocar** a propósito: administración la usa para sus notas
 * ("REMITOS MEMBRANEX", "YA PAGADA EN EFECTIVO") y pisarla sería sacarles un
 * campo que ya usan para otra cosa.
 *
 * ## El total se reconstruye desde el total
 *
 * El QR trae el importe **con IVA** y una línea de Odoo lleva el neto, así que
 * el neto sale de dividir por 1,21. Contra las 793 facturas A del grupo eso
 * reproduce el total **exacto en 785** y en las 8 restantes queda a menos de dos
 * centavos. No se esconde: el push relee el total que quedó en Odoo y avisa si
 * no coincide.
 *
 * ## El producto no hace falta
 *
 * A diferencia de `purchase.order.line` —que sí lo exige por una restricción SQL
 * del modelo—, una línea de `account.move` sin producto se crea sin problema:
 * Odoo le pone la cuenta de gasto que corresponda al proveedor.
 */

export interface DatosParaElBorrador {
  cuit_emisor: string | null;
  tipo_comprobante: number | null;
  punto_venta: number | null;
  numero: number | null;
  fecha: string | null;
  importe_total: number | null;
  moneda: string | null;
}

export interface ContextoDelBorrador {
  /** El `res.partner` del proveedor **en esa empresa**. */
  partnerId: number;
  /** El diario de compras de la empresa. */
  diarioId: number;
  /** El IVA 21% de la empresa. `null` cuando el comprobante no discrimina. */
  impuestoId: number | null;
  /** `res.currency` de la moneda de la factura. */
  monedaId: number;
  /** El `voucher.type` cuyo `code` es el tipo de comprobante del QR. */
  voucherTypeId: number | null;
  /** El RI que la origina, para que la línea lo diga. */
  nroRi?: number | null;
}

export interface BorradorArmado {
  vals: Record<string, unknown>;
  /** Lo que va a quedar en Odoo, para poder compararlo con el comprobante. */
  neto: number;
  totalEsperado: number;
  /** `in_invoice` o `in_refund`. */
  tipo: "in_invoice" | "in_refund";
}

export type ResultadoDelBorrador =
  | { ok: true; borrador: BorradorArmado }
  | { ok: false; problemas: string[] };

/** Dos decimales, que es lo que Odoo guarda en `price_unit` (`digits: [16, 2]`). */
function aDosDecimales(n: number): number {
  return Math.round(n * 100) / 100;
}

const IVA = 0.21;

export function armarBorradorDeFactura(
  factura: DatosParaElBorrador,
  contexto: ContextoDelBorrador
): ResultadoDelBorrador {
  const problemas: string[] = [];

  /*
   * Los datos sin los cuales el borrador no serviría de nada. Una factura sin
   * fecha o sin importe entra igual al buzón —la entrada nunca se bloquea—, pero
   * mandarla así a Odoo sería crear un borrador que alguien tiene que completar
   * igual, o sea el trabajo que este módulo vino a sacar.
   */
  if (!factura.fecha) problemas.push("La factura no tiene fecha: hay que completarla antes.");

  const total = Math.abs(Number(factura.importe_total ?? 0));
  if (!total) problemas.push("La factura no tiene importe: hay que completarlo antes.");

  if (factura.punto_venta === null || factura.numero === null) {
    problemas.push(
      "La factura no tiene punto de venta y número, que es lo único que la identifica en Odoo."
    );
  }

  /*
   * Sin tipo de comprobante el borrador se crearía, pero **no se podría
   * postear**: es la validación de la localización del grupo. Más vale decirlo
   * acá que dejar un borrador trabado que alguien tiene que descubrir.
   */
  if (contexto.voucherTypeId === null) {
    problemas.push(
      factura.tipo_comprobante === null
        ? "La factura no dice qué tipo de comprobante es, y Odoo no deja postear sin eso."
        : `Odoo no tiene ningún tipo de comprobante con el código ${factura.tipo_comprobante}, ` +
            `así que el borrador no se podría postear.`
    );
  }

  if (problemas.length) return { ok: false, problemas };

  const conIva = discriminaIva(factura.tipo_comprobante) && contexto.impuestoId !== null;
  const neto = conIva ? aDosDecimales(total / (1 + IVA)) : total;
  const totalEsperado = conIva ? aDosDecimales(neto + aDosDecimales(neto * IVA)) : neto;
  const tipo = esNotaDeCredito(factura.tipo_comprobante) ? "in_refund" : "in_invoice";

  /*
   * La descripción de la línea repite el comprobante en castellano y agrega el
   * RI si lo hay. Es lo que se imprime y lo que ve el que revisa el borrador:
   * decirle "Factura A 0006-00010192 · RI 1933" le ahorra abrir dos pantallas
   * para saber de qué compra le están hablando.
   */
  const descripcion = [
    nombreDelComprobante({
      tipoComprobante: factura.tipo_comprobante,
      puntoVenta: factura.punto_venta,
      numero: factura.numero,
    }),
    contexto.nroRi ? `RI ${contexto.nroRi}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    ok: true,
    borrador: {
      tipo,
      neto,
      totalEsperado,
      vals: {
        move_type: tipo,
        partner_id: contexto.partnerId,
        journal_id: contexto.diarioId,
        currency_id: contexto.monedaId,
        invoice_date: factura.fecha,
        voucher_type_id: contexto.voucherTypeId,
        // Cuatro y ocho dígitos, que es como lo escribe el grupo y como sale
        // impreso en el comprobante.
        voucher_name: numeroFormateado(factura.punto_venta, factura.numero),
        invoice_line_ids: [
          [
            0,
            0,
            {
              name: descripcion,
              quantity: 1,
              price_unit: neto,
              /*
               * `[[6, 0, ids]]` reemplaza los impuestos en vez de sumarlos. Sin
               * el 6, Odoo deja además el impuesto por defecto del producto o de
               * la cuenta y la factura totaliza de más.
               */
              tax_ids: [[6, 0, conIva ? [contexto.impuestoId] : []]],
            },
          ],
        ],
      },
    },
  };
}
