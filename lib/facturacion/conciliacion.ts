import { normalizarCuit } from "@/lib/core/cuit";

/**
 * Reconocer en Odoo la factura que ya está en el buzón.
 *
 * Es "cerrar el círculo": hasta ahora alguien apretaba **Ya está en Odoo** y el
 * sistema le creía. Esto lo averigua.
 *
 * ## De dónde sale el número, medido sobre las 6.423 facturas de la instancia
 *
 * El Odoo del grupo tiene una localización argentina propia (`odoo_l10n_ar`), y
 * ahí el comprobante tiene campos de verdad:
 *
 * - **`voucher_name`** — el número, `0006-00010192`. Está en **6.412 de 6.423
 *   (99,8%)**, y en **todas** las posteadas: la localización no deja postear sin
 *   él.
 * - **`voucher_type_id`** — el tipo, cuyo `code` es el número de ARCA. El mismo
 *   que trae el QR.
 *
 * El `name` (`BILL/2026/09/0004`) es una secuencia interna que no tiene nada que
 * ver con el papel, y mientras está en borrador es `/`: nunca sirve para
 * reconocer un comprobante.
 *
 * ## Por qué la referencia es sólo un respaldo
 *
 * `ref` es texto libre donde administración escribe notas: `FC A 00008-00003715`
 * pero también `REMITOS MEMBRANEX` o `YA PAGADA EN EFECTIVO`. Está en el 24% de
 * las facturas, mezcla varios comprobantes en una (321 de 1.147 referencias) y
 * **repite el mismo número en asientos distintos** — `FC A 00008-00003291`
 * figura en seis facturas de RUBIALES, con seis importes y seis fechas—. Sirve
 * para las 11 facturas sin `voucher_name`, y nada más: cuando hay alguna
 * coincidencia por el campo propio, las de la referencia se descartan.
 *
 * ## Por qué nunca por el importe
 *
 * El trío (proveedor, fecha, importe) repite en el 1,4% de las facturas de 2026;
 * sin la fecha, en el 14,5%. Un 1,4% de enlaces mudos y equivocados es
 * exactamente lo que este sistema no hace: *enlazar al que se le parece es peor
 * que dejar en null*, y acá menos que en ningún lado — la factura aparecería
 * como contabilizada y nadie volvería a mirarla.
 */

export interface NumeroDeComprobante {
  puntoVenta: number;
  numero: number;
}

/** `0006-00010192` → `{ puntoVenta: 6, numero: 10192 }`. */
export function numeroDelVoucher(
  voucherName: string | null | undefined
): NumeroDeComprobante | null {
  if (!voucherName) return null;
  const m = String(voucherName).trim().match(/^(\d{1,5})\s*-\s*(\d{1,10})$/);
  if (!m) return null;
  return { puntoVenta: Number(m[1]), numero: Number(m[2]) };
}

/**
 * Los números de comprobante que aparecen en una referencia de texto libre.
 *
 * El patrón es deliberadamente ancho —`punto de venta - número`, con o sin
 * espacios— porque el corpus real lo es: `FC   A 00008-00003738`,
 * `FC A - 00008-00003683 - FC A - 00008-00003691`. Contra las 1.147 referencias
 * cargadas encuentra número en el 96,5%; el 3,5% restante es texto que nunca fue
 * un número.
 *
 * Devuelve enteros a propósito: el punto de venta está escrito con cuatro
 * dígitos en 214 casos y con cinco en 1.745, y `00006` y `0006` son el mismo.
 */
export function numerosDeLaReferencia(ref: string | null | undefined): NumeroDeComprobante[] {
  if (!ref) return [];

  const encontrados: NumeroDeComprobante[] = [];
  for (const m of String(ref).matchAll(/(\d{1,5})\s*-\s*(\d{1,10})/g)) {
    const puntoVenta = Number(m[1]);
    const numero = Number(m[2]);
    if (!puntoVenta && !numero) continue;
    if (!encontrados.some((n) => n.puntoVenta === puntoVenta && n.numero === numero)) {
      encontrados.push({ puntoVenta, numero });
    }
  }
  return encontrados;
}

/** Una factura de proveedor de Odoo, con lo que hace falta para reconocerla. */
export interface MovimientoDeOdoo {
  id: number;
  /** `voucher_name`: el número del comprobante, en su campo propio. */
  voucherName: string | null;
  /** `voucher_type_id.code`: el tipo de comprobante, en código de ARCA. */
  voucherCodigo: number | null;
  /** `ref`: texto libre. Sólo se mira si no hay `voucherName`. */
  ref: string | null;
  /** El CUIT del `res.partner`, como venga: se normaliza acá. */
  cuitDelPartner: string | null;
  /** `res.company` de Odoo. */
  empresaOdoo: number | null;
  estado: string;
  fecha: string | null;
  importeTotal: number;
  /** `BILL/2026/09/0004`, o `/` mientras está en borrador. */
  nombre: string | null;
}

/** Una factura del buzón que todavía no se sabe si llegó a Odoo. */
export interface FacturaParaConciliar {
  id: string;
  cuit_emisor: string | null;
  tipo_comprobante: number | null;
  punto_venta: number | null;
  numero: number | null;
  importe_total: number | null;
  /** `res.company` al que se le facturó, cuando se sabe. */
  empresaOdoo: number | null;
}

export interface VinculoEncontrado {
  facturaId: string;
  odooMoveId: number;
  odooNombre: string | null;
  odooEstado: string;
  /** Por dónde se lo reconoció: el campo propio o la referencia de texto libre. */
  por: "numero" | "referencia";
  /** Un aviso cuando el enlace es seguro pero algo no cuadra. */
  aviso: string | null;
}

export interface ResultadoDeLaConciliacion {
  vinculos: VinculoEncontrado[];
  /** Facturas que empataron con más de una de Odoo: no se tocan. */
  ambiguas: { facturaId: string; candidatos: number[] }[];
}

function mismoCuit(a: string | null, b: string | null): boolean {
  const x = normalizarCuit(a);
  const y = normalizarCuit(b);
  return x !== null && x === y;
}

function esLaMisma(n: NumeroDeComprobante, f: FacturaParaConciliar): boolean {
  return n.puntoVenta === f.punto_venta && n.numero === f.numero;
}

/**
 * Qué facturas del buzón están en Odoo, con certeza.
 *
 * Nunca devuelve un enlace dudoso: si dos facturas de Odoo reclaman la misma del
 * buzón, la factura queda sin vincular y se informa. Es el caso raro —una
 * recarga, una factura anulada y vuelta a cargar— pero es justo donde elegir una
 * al azar deja el importe contado dos veces.
 */
export function conciliar(
  facturas: FacturaParaConciliar[],
  movimientos: MovimientoDeOdoo[]
): ResultadoDeLaConciliacion {
  const analizados = movimientos.map((m) => ({
    movimiento: m,
    voucher: numeroDelVoucher(m.voucherName),
    referencia: numerosDeLaReferencia(m.ref),
  }));

  const vinculos: VinculoEncontrado[] = [];
  const ambiguas: ResultadoDeLaConciliacion["ambiguas"] = [];

  for (const factura of facturas) {
    if (factura.punto_venta === null || factura.numero === null) continue;

    const delMismoProveedor = analizados.filter(({ movimiento }) => {
      if (!mismoCuit(factura.cuit_emisor, movimiento.cuitDelPartner)) return false;
      /*
       * La empresa tiene que coincidir cuando las dos se conocen. Una factura a
       * nombre de POLCECAL enlazada a un asiento de POLYSAN sería un enlace
       * correcto en apariencia y una contabilidad equivocada.
       */
      return (
        factura.empresaOdoo === null ||
        movimiento.empresaOdoo === null ||
        factura.empresaOdoo === movimiento.empresaOdoo
      );
    });

    /*
     * Primero el campo propio. Si además los dos saben qué tipo de comprobante
     * son, tienen que ser el mismo: una nota de crédito y la factura que revierte
     * pueden llevar el mismo número, y son documentos distintos.
     */
    let por: VinculoEncontrado["por"] = "numero";
    let candidatos = delMismoProveedor.filter(
      ({ voucher, movimiento }) =>
        voucher !== null &&
        esLaMisma(voucher, factura) &&
        (movimiento.voucherCodigo === null ||
          factura.tipo_comprobante === null ||
          movimiento.voucherCodigo === factura.tipo_comprobante)
    );

    // Y sólo si no hubo ninguna, la referencia de texto libre.
    if (candidatos.length === 0) {
      por = "referencia";
      candidatos = delMismoProveedor.filter(
        ({ voucher, referencia }) =>
          voucher === null && referencia.some((n) => esLaMisma(n, factura))
      );
    }

    if (candidatos.length === 0) continue;

    if (candidatos.length > 1) {
      ambiguas.push({ facturaId: factura.id, candidatos: candidatos.map((c) => c.movimiento.id) });
      continue;
    }

    const { movimiento, voucher, referencia } = candidatos[0];

    /*
     * El importe sólo se compara cuando el asiento cubre **un solo**
     * comprobante. Cuando agrupa varios en la referencia —que es lo que hacen con
     * Rubiales, Bax o Sandoval— el total es la suma y que no coincida es lo
     * esperado.
     */
    const cubreUnoSolo = voucher !== null || referencia.length === 1;
    const aviso =
      cubreUnoSolo &&
      factura.importe_total !== null &&
      Math.abs(Math.abs(movimiento.importeTotal) - Math.abs(factura.importe_total)) > 0.01
        ? `En Odoo figura por ${movimiento.importeTotal} y el comprobante dice ${factura.importe_total}.`
        : null;

    vinculos.push({
      facturaId: factura.id,
      odooMoveId: movimiento.id,
      odooNombre: movimiento.nombre,
      odooEstado: movimiento.estado,
      por,
      aviso,
    });
  }

  return { vinculos, ambiguas };
}

/**
 * El estado del buzón que corresponde al de Odoo.
 *
 * `posted` es el único que cierra el círculo: una factura posteada es un asiento
 * inmutable con numeración fiscal, o sea que la carga contable terminó. Un
 * borrador dice que llegó, no que se contabilizó.
 */
export function estadoSegunOdoo(estadoDeOdoo: string): "informada" | "contabilizada" | null {
  if (estadoDeOdoo === "posted") return "contabilizada";
  if (estadoDeOdoo === "draft") return "informada";
  return null;
}
