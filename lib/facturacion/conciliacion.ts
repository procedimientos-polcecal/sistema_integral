import { normalizarCuit } from "@/lib/core/cuit";

/**
 * Reconocer en Odoo la factura que ya está en el buzón.
 *
 * Es "cerrar el círculo": hoy alguien aprieta **Ya está en Odoo** y el sistema
 * le cree. Esto lo averigua.
 *
 * ## Por qué se concilia por el número y no por el importe
 *
 * Medido sobre las 6.423 facturas de proveedor de la instancia (11/09/2026):
 *
 * - **Odoo no tiene la localización argentina instalada.** El `name` de una
 *   factura de proveedor es `BILL/2026/09/0004`, una secuencia interna que no
 *   tiene nada que ver con el comprobante. El número fiscal, cuando está, está
 *   en `ref`.
 * - **`ref` está escrito a mano y a mano no hay formato**: `FC A 00008-00003715`,
 *   `FC   A 00008-00003738`, `FC A - 00008-00003683`, y muy seguido **varios
 *   comprobantes en una sola factura de Odoo** (321 de 1.147 referencias). Por
 *   eso se extraen *todos* los pares que aparezcan y una factura de Odoo puede
 *   quedar vinculada a varias del buzón: eso no es un error, es lo que hicieron.
 * - **El trío (proveedor, fecha, importe) no alcanza.** Repite en el 1,4% de las
 *   facturas de 2026; sin la fecha, en el 14,5%. Un 1,4% de enlaces mudos y
 *   equivocados es exactamente lo que este sistema no hace: *enlazar al que se
 *   le parece es peor que dejar en null*, porque un enlace equivocado no se nota
 *   nunca.
 *
 * Entonces la conciliación automática pide **las dos cosas**: que el CUIT del
 * emisor sea el del proveedor de la factura de Odoo, y que el par
 * (punto de venta, número) aparezca en su referencia. Lo que no cumple eso queda
 * para que lo mire una persona, con los candidatos servidos.
 */

export interface NumeroDeComprobante {
  puntoVenta: number;
  numero: number;
}

/**
 * Los números de comprobante que aparecen en una referencia de Odoo.
 *
 * El patrón es deliberadamente ancho —`punto de venta - número`, con o sin
 * espacios— porque el corpus real lo es. Contra las 1.147 referencias cargadas
 * encuentra número en el 96,5%; el 3,5% que no son texto libre que nunca fue un
 * número (`REMITOS MEMBRANEX`, `YA PAGADA EN EFECTIVO`).
 *
 * Se devuelven como enteros a propósito: el punto de venta está escrito con
 * cuatro dígitos en 214 casos y con cinco en 1.745, y `00006` y `0006` son el
 * mismo punto de venta.
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

/**
 * Qué facturas del buzón están en Odoo, con certeza.
 *
 * Nunca devuelve un enlace dudoso: si dos facturas de Odoo reclaman la misma del
 * buzón, la factura queda sin vincular y se informa. Es el caso raro —una
 * recarga, una factura anulada y vuelta a cargar— pero es justo el caso donde
 * elegir una al azar deja el importe contado dos veces.
 */
export function conciliar(
  facturas: FacturaParaConciliar[],
  movimientos: MovimientoDeOdoo[]
): ResultadoDeLaConciliacion {
  const numerosPorMovimiento = movimientos.map((m) => ({
    movimiento: m,
    numeros: numerosDeLaReferencia(m.ref),
  }));

  const vinculos: VinculoEncontrado[] = [];
  const ambiguas: ResultadoDeLaConciliacion["ambiguas"] = [];

  for (const factura of facturas) {
    if (factura.punto_venta === null || factura.numero === null) continue;

    const candidatos = numerosPorMovimiento.filter(({ movimiento, numeros }) => {
      if (!mismoCuit(factura.cuit_emisor, movimiento.cuitDelPartner)) return false;
      /*
       * La empresa tiene que coincidir cuando las dos se conocen. Una factura a
       * nombre de POLCECAL enlazada a un asiento de POLYSAN sería un enlace
       * correcto en apariencia y una contabilidad equivocada.
       */
      if (
        factura.empresaOdoo !== null &&
        movimiento.empresaOdoo !== null &&
        factura.empresaOdoo !== movimiento.empresaOdoo
      ) {
        return false;
      }
      return numeros.some(
        (n) => n.puntoVenta === factura.punto_venta && n.numero === factura.numero
      );
    });

    if (candidatos.length === 0) continue;

    if (candidatos.length > 1) {
      ambiguas.push({ facturaId: factura.id, candidatos: candidatos.map((c) => c.movimiento.id) });
      continue;
    }

    const { movimiento, numeros } = candidatos[0];

    /*
     * El importe sólo se compara cuando la factura de Odoo cubre **un solo**
     * comprobante. Cuando agrupa varios —que es lo que hacen con Rubiales, Bax o
     * Sandoval— el total es la suma y que no coincida es lo esperado.
     */
    const aviso =
      numeros.length === 1 &&
      factura.importe_total !== null &&
      Math.abs(Math.abs(movimiento.importeTotal) - Math.abs(factura.importe_total)) > 0.01
        ? `En Odoo figura por ${movimiento.importeTotal} y el comprobante dice ${factura.importe_total}.`
        : null;

    vinculos.push({
      facturaId: factura.id,
      odooMoveId: movimiento.id,
      odooNombre: movimiento.nombre,
      odooEstado: movimiento.estado,
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
