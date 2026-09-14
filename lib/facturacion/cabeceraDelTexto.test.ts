import { describe, it, expect } from "vitest";
import { leerCabeceraDelTexto } from "./cabeceraDelTexto";
import { leerQrAfip } from "./qrAfip";

/*
 * Las filas son **textuales** del PDF de ALMENTA, factura A 0006-00010192, que
 * está en el bucket: salieron de `getTextContent()` de pdf.js. Y esa factura
 * además tiene QR, así que sirve de banco de pruebas — lo que el texto saque se
 * puede comparar contra lo que dijo ARCA, que es la verdad.
 */
const ALMENTA = [
  "FACTURA Nº: 0006-00010192",
  "FACTURA Nº: 0006-00010192",
  "A A",
  "Fecha: 10/9/2026",
  "Cod.01 Cod.01 Fecha: 10/9/2026",
  "RESPONSABLE INSCRIPTO",
  "Necochea 2918 - OLAVARRIA Cp 7400 C.U.I.T.: 20-16581164-0 Necochea 2918 - OLAVARRIA Cp 7400",
  "C.U.I.T.: 20-16581164-0",
  "02284 420765 Ingresos Brutos: 20-16581164-0 02284 420765",
  "juancarlosalmenta@yahoo.com.ar Inicio Actividades: 01/11/2004 juancarlosalmenta@yahoo.com.ar",
  "Sr./es: POLCECAL S.A. ( 1073 ) Sr./es: POLCECAL S.A. ( 1073 )",
  "Domicilio: OLAVARRIA SIERRAS BAYAS Domicilio: OLAVARRIA SIERRAS BAYAS",
  "I Responsable Inscripto C.U.I.T.: 30-64106801-9 C.U.I.T.: 30-64106801-9",
  "Cond. de Venta: Vto.: 10/09/2026 Cond. de Venta: Vto.: 10/09/2026",
  "PRODUCTO CANT. P / U TOTAL PRODUCTO CANT. P / U TOTAL",
  "CPO BOMBA MOTORARG 428X4/7.5 1,00 528.428,93 528.428,93",
  "Subtotal 1466699,26 1466699,26",
  "Bonificación 0,00 0,00",
  "I.V.A. 10,5% 0,00 0,00",
  "C.A.E.: 86372444134504 86372444134504",
  "I.V.A. 21% 308006,84 I.V.A. 21% 308006,84",
  "Fecha Vto.: 20/09/2026 TOTAL $ 1.774.706,10",
];

/** El QR de esa misma factura, textual. Es la verdad contra la que se compara. */
const QR_DE_ALMENTA =
  "https://www.arca.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0wOS0xMCIsImN1aXQiOjIwMTY1ODExNjQwLCJwdG9WdGEiOjYsInRpcG9DbXAiOjEsIm5yb0NtcCI6MTAxOTIsImltcG9ydGUiOjE3NzQ3MDYuMSwibW9uZWRhIjoiUEVTIiwiY3R6IjoxLCJ0aXBvRG9jUmVjIjo4MCwibnJvRG9jUmVjIjozMDY0MTA2ODAxOSwidGlwb0NvZEF1dCI6IkUiLCJjb2RBdXQiOjg2MzcyNDQ0MTM0NTA0fQ==";

const DEL_GRUPO = ["30641068019", "30707285008"];

describe("la cabecera leída del texto, contra lo que dijo el QR", () => {
  it("saca los seis campos y coinciden con ARCA", () => {
    const delQr = leerQrAfip(QR_DE_ALMENTA);
    expect(delQr.ok).toBe(true);
    if (!delQr.ok) return;

    const { cabecera, falta } = leerCabeceraDelTexto(ALMENTA, DEL_GRUPO);
    expect(falta).toEqual([]);
    expect(cabecera).not.toBeNull();

    expect(cabecera!.cuitEmisor).toBe(delQr.cabecera.cuitEmisor);
    expect(cabecera!.tipoComprobante).toBe(delQr.cabecera.tipoComprobante);
    expect(cabecera!.puntoVenta).toBe(delQr.cabecera.puntoVenta);
    expect(cabecera!.numero).toBe(delQr.cabecera.numero);
    expect(cabecera!.fecha).toBe(delQr.cabecera.fecha);
    expect(cabecera!.importeTotal).toBe(delQr.cabecera.importeTotal);
    expect(cabecera!.cuitReceptor).toBe(delQr.cabecera.cuitReceptor);
    expect(cabecera!.cae).toBe(delQr.cabecera.cae);
  });

  it("deja rastro de que no vino de un QR", () => {
    expect(leerCabeceraDelTexto(ALMENTA, DEL_GRUPO).cabecera!.version).toBe(0);
  });
});

describe("distinguir el emisor del receptor", () => {
  /*
   * Es lo único que podría salir mal y no notarse: confundirlos pondría la
   * factura a nombre del grupo. Se resuelve por un dato que ya tenemos, no por
   * dónde está impreso cada uno.
   */
  it("el CUIT del grupo es el receptor, el otro el emisor", () => {
    const { parcial } = leerCabeceraDelTexto(ALMENTA, DEL_GRUPO);
    expect(parcial.cuitEmisor).toBe("20165811640");
    expect(parcial.cuitReceptor).toBe("30641068019");
  });

  it("no depende del orden en que estén impresos", () => {
    const alReves = [...ALMENTA].reverse();
    const { parcial } = leerCabeceraDelTexto(alReves, DEL_GRUPO);
    expect(parcial.cuitEmisor).toBe("20165811640");
    expect(parcial.cuitReceptor).toBe("30641068019");
  });

  it("sin los CUIT del grupo no se arriesga a decir cuál es cuál", () => {
    const { parcial } = leerCabeceraDelTexto(ALMENTA, []);
    expect(parcial.cuitReceptor).toBeNull();
    // El primero que aparece se toma como emisor, y es el correcto acá, pero
    // sin el padrón del grupo eso es una suposición: por eso el receptor queda
    // vacío en vez de inventarse.
    expect(parcial.cuitEmisor).toBe("20165811640");
  });
});

describe("cada campo, y las trampas de cada uno", () => {
  it("el número no se confunde con un CUIT", () => {
    // `20-16581164-0` tiene la forma de un par, pero el punto de venta lleva
    // cuatro o cinco dígitos.
    const { parcial } = leerCabeceraDelTexto(["C.U.I.T.: 20-16581164-0"], DEL_GRUPO);
    expect(parcial.puntoVenta).toBeNull();
  });

  it("la fecha de emisión no es la de vencimiento ni la de inicio de actividades", () => {
    const { parcial } = leerCabeceraDelTexto(ALMENTA, DEL_GRUPO);
    expect(parcial.fecha).toBe("2026-09-10");
  });

  it("la fecha se lee d/m y no m/d", () => {
    const { parcial } = leerCabeceraDelTexto(["Fecha: 3/12/2026"], DEL_GRUPO);
    expect(parcial.fecha).toBe("2026-12-03");
  });

  it("el total no es el subtotal", () => {
    const { parcial } = leerCabeceraDelTexto(ALMENTA, DEL_GRUPO);
    expect(parcial.importeTotal).toBe(1774706.1);
  });

  it("el tipo sale del código impreso, que es el de ARCA", () => {
    expect(leerCabeceraDelTexto(["Cod.01", "FACTURA"], DEL_GRUPO).parcial.tipoComprobante).toBe(1);
    expect(leerCabeceraDelTexto(["Cód. 06"], DEL_GRUPO).parcial.tipoComprobante).toBe(6);
  });

  it("sin código impreso, lo arma con el documento y la letra", () => {
    expect(
      leerCabeceraDelTexto(["NOTA DE CREDITO", "A"], DEL_GRUPO).parcial.tipoComprobante
    ).toBe(3);
    expect(leerCabeceraDelTexto(["FACTURA", "C C"], DEL_GRUPO).parcial.tipoComprobante).toBe(11);
  });
});

describe("cuando no alcanza", () => {
  it("dice qué falta en vez de devolver una cabecera a medias", () => {
    const { cabecera, falta } = leerCabeceraDelTexto(["FACTURA", "algo suelto"], DEL_GRUPO);
    expect(cabecera).toBeNull();
    expect(falta).toContain("el CUIT del emisor");
    expect(falta).toContain("el importe");
  });

  it("con una hoja vacía no inventa nada", () => {
    const r = leerCabeceraDelTexto([], DEL_GRUPO);
    expect(r.cabecera).toBeNull();
    expect(r.parcial.importeTotal).toBeNull();
  });

  /*
   * Una factura sin capa de texto —un escaneo— no da filas. Que devuelva vacío
   * y no reviente es lo que permite que la entrada del buzón nunca se bloquee.
   */
  it("un escaneo sin texto no rompe nada", () => {
    expect(() => leerCabeceraDelTexto([""], DEL_GRUPO)).not.toThrow();
  });
});
