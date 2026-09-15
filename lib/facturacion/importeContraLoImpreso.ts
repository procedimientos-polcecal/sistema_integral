import { leerCabeceraDelTexto } from "./cabeceraDelTexto";

/**
 * Contrastar el importe que firmó el QR contra el que está impreso en la hoja.
 *
 * ## Por qué hace falta si el QR es la fuente
 *
 * Porque **hay emisores que firman el QR mal**. REPUESTOS AGRÍCOLAS COLON y EL
 * MANU MATERIALES ponen el importe sin el punto decimal: la factura
 * 0004-00029315 está impresa `Total $ 27.830.00` y su QR dice
 * `"importe":2783000`. El payload viene además corrupto —tabuladores en medio
 * del JSON— así que los dos salen del mismo sistema de facturación.
 *
 * Medido sobre las 187 facturas de septiembre de 2026: **11 (6%) tienen el
 * importe del QR exactamente cien veces el impreso**, y todos los meses entran
 * al borrador de Odoo cien veces más grandes. El único control que había era que
 * una persona mirara el número.
 *
 * ## Qué hace y qué no
 *
 * **Avisa. No corrige.** El QR sigue siendo la fuente —es el dato firmado por
 * ARCA— y cambiarlo por lo que dice un texto impreso sería sustituir un dato
 * verificable por una lectura nuestra. Lo que hace es poner el conflicto
 * adelante de quien carga, que es quien puede mirar el papel.
 *
 * ## Por qué sólo el ×100 y no cualquier diferencia
 *
 * Porque avisar de todo sería enseñar a ignorar el aviso. En las 151 facturas de
 * septiembre que traen QR **y** capa de texto, el lector de texto difiere del QR
 * en 17 importes: 11 son este caso —exactamente ×100— y las otras 6 son el
 * lector equivocándose (se queda con el neto, con el subtotal de una línea o con
 * el total de otro comprobante). Con la regla del ×100 el aviso salta en esas 11
 * y **en ninguna otra**: cero falsos positivos sobre 151.
 *
 * Cuando el lector de texto mejore, esto se puede abrir a otras diferencias. Hoy
 * sería ruido.
 */

/** Cuánto puede alejarse de exactamente ×100 y seguir siendo el mismo error. */
const TOLERANCIA = 0.005;

export interface AvisoDelImporte {
  /** El del QR, que es el que se va a usar salvo que alguien lo cambie. */
  delQr: number;
  /** El que está impreso en la hoja. */
  impreso: number;
  texto: string;
}

/**
 * `null` cuando no hay nada que decir: sin QR, sin texto, o cuando los dos
 * importes son el mismo.
 */
export function avisarSiElQrNoCoincide(
  importeDelQr: number | null | undefined,
  filas: string[],
  cuitsDelGrupo: string[]
): AvisoDelImporte | null {
  if (!importeDelQr || !filas.length) return null;

  const impreso = leerCabeceraDelTexto(filas, cuitsDelGrupo).parcial.importeTotal;
  if (!impreso) return null;

  const veces = importeDelQr / impreso;
  if (Math.abs(veces - 100) > TOLERANCIA) return null;

  return {
    delQr: importeDelQr,
    impreso,
    texto:
      `El QR dice ${pesos(importeDelQr)} y en la hoja está impreso ${pesos(impreso)}: ` +
      "cien veces menos. Hay emisores que firman el QR con el importe en centavos. " +
      "Se va a guardar el del QR, así que revisá el borrador en Odoo antes de confirmarlo.",
  };
}

function pesos(n: number): string {
  return n.toLocaleString("es-AR", { style: "currency", currency: "ARS" });
}
