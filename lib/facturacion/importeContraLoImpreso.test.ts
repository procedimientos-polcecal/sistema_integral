import { describe, it, expect } from "vitest";
import { avisarSiElQrNoCoincide } from "./importeContraLoImpreso";

const DEL_GRUPO = ["30641068019", "30707285008"];

/*
 * Las filas son textuales de `04-29315 REPUESTOS AGRICOLAS COLON.pdf`, cuyo QR
 * dice `"importe":2783000` sobre una factura impresa `Total $ 27.830.00`.
 */
const COLON = [
  "FACTURA A Nº 0004-00029315",
  "C.U.I.T.: 30-71077315-3",
  "CUIT: 30-64106801-9",
  "Fecha: 8/9/2026",
  "Subtotal $ 23.000.00",
  "Total $ 27.830.00",
];

describe("el QR contra lo impreso", () => {
  it("avisa cuando el QR dice cien veces lo impreso", () => {
    const aviso = avisarSiElQrNoCoincide(2783000, COLON, DEL_GRUPO);
    expect(aviso).not.toBeNull();
    expect(aviso!.impreso).toBe(27830);
    expect(aviso!.delQr).toBe(2783000);
    expect(aviso!.texto).toContain("cien veces menos");
  });

  it("no dice nada cuando los dos coinciden", () => {
    expect(avisarSiElQrNoCoincide(27830, COLON, DEL_GRUPO)).toBeNull();
  });

  /*
   * El umbral existe para que el aviso no sea ruido. Estas tres diferencias son
   * reales —salieron del control del banco— y **no** son el error del emisor:
   * son el lector de texto quedándose con el neto, con el subtotal de una línea
   * o con el total de otro comprobante. Si saltaran, la gente aprendería a
   * ignorar el cartel.
   */
  it("no avisa por una diferencia que no es el ×100", () => {
    const conTotal = (n: string) => [`Total $ ${n}`];
    // El neto en vez del total: ratio 1,21 (FUNDICIÓN ELÉCTRICA NAVARRO).
    expect(avisarSiElQrNoCoincide(2101770, conTotal("1.737.000,00"), DEL_GRUPO)).toBeNull();
    // Un total de otro comprobante: ratio 4,88 (NC CASA CAMINO).
    expect(avisarSiElQrNoCoincide(257683.66, conTotal("52.805,85"), DEL_GRUPO)).toBeNull();
    // Y el caso al revés, donde el texto lee de más.
    expect(avisarSiElQrNoCoincide(4665.07, conTotal("7.160.882,45"), DEL_GRUPO)).toBeNull();
  });

  it("tolera el redondeo, que ×100 no siempre da exacto", () => {
    expect(avisarSiElQrNoCoincide(11626769, ["Total $ 116.267.69"], DEL_GRUPO)).not.toBeNull();
  });

  it("sin QR, sin texto o sin total impreso no hay nada que decir", () => {
    expect(avisarSiElQrNoCoincide(null, COLON, DEL_GRUPO)).toBeNull();
    expect(avisarSiElQrNoCoincide(2783000, [], DEL_GRUPO)).toBeNull();
    expect(avisarSiElQrNoCoincide(2783000, ["una hoja sin total"], DEL_GRUPO)).toBeNull();
  });
});
