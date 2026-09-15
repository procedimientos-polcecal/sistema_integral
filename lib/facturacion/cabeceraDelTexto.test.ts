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

/*
 * Las filas de abajo son **textuales** de las facturas de septiembre de 2026,
 * sacadas con `getTextContent()`. Son las cuatro familias que el banco
 * (`scripts/banco-de-qr.mts`) dejó a la vista: 28 de las 31 que no se leían.
 */

const ZITO = [
  "A Fecha de Emisión: 02/09/2026 09:14:16",
  "Zito y Priola S.R.L COD.01",
  "Factura 0027-00070568",
  "C.U.I.T 30-71182027-9",
  "Vencimiento: 02/09/2026",
  "Razón Social: POLCECAL S.A. CUIT: 30-64106801-9",
  "Cantidad Código Descripción Precio Unit. Imp. Int. Tasa IVA Precio Subtotal",
  "436.3156 3 (3)DIESEL 500 1,668.75 263.8382 30.98 21.00 2,314.00 728,100.97",
  "Precio sin impuestos IVA % IVA contenido ICL/imp.int. Tasas Percepciones Tasa Vial Total",
  "1,231,198.18 21.00 258,551.62 187,986.17 21,820.71 0.00 0.00 1,699,556.67",
];

describe("ZITO Y PRIOLA: 22 de las 187, y no traen QR", () => {
  it("la fecha de emisión aunque la palabra esté lejos del número", () => {
    expect(leerCabeceraDelTexto(ZITO, DEL_GRUPO).parcial.fecha).toBe("2026-09-02");
  });

  /*
   * El total está en la fila de ABAJO de la que dice "Total", que es el
   * encabezado de la tabla de impuestos. Y viene con separador de miles a la
   * inglesa.
   */
  it("el total sale de la fila siguiente al encabezado", () => {
    expect(leerCabeceraDelTexto(ZITO, DEL_GRUPO).parcial.importeTotal).toBe(1699556.67);
  });

  it("no se queda con el subtotal de una línea, que también está en esa fila", () => {
    expect(leerCabeceraDelTexto(ZITO, DEL_GRUPO).parcial.importeTotal).not.toBe(728100.97);
  });

  it("con eso la cabecera queda completa", () => {
    const { cabecera, falta } = leerCabeceraDelTexto(ZITO, DEL_GRUPO);
    expect(falta).toEqual([]);
    expect(cabecera).toMatchObject({
      cuitEmisor: "30711820279",
      cuitReceptor: "30641068019",
      puntoVenta: 27,
      numero: 70568,
      fecha: "2026-09-02",
      importeTotal: 1699556.67,
    });
  });

  it("no toma el vencimiento, que en esta factura es el mismo día", () => {
    const conOtroVto = ZITO.map((f) => (f.startsWith("Vencimiento") ? "Vencimiento: 30/09/2026" : f));
    expect(leerCabeceraDelTexto(conOtroVto, DEL_GRUPO).parcial.fecha).toBe("2026-09-02");
  });
});

/*
 * El caso que más importa de los cuatro: acá el lector **no fallaba, mentía**.
 * Sobre `41,269,391.77` el parseo viejo devolvía 177.
 */
describe("COOPELECTRIC: el importe que salía estaba mal, no ausente", () => {
  const COOPELECTRIC = [
    "FECHA DE EMISIÓN: 14/09/2026 CÓDIGO 017",
    "C.U.I.T.: 30-54569139-2",
    "Nº 0008-00453668",
    "CUIT: 30-70728500-8",
    "TOTAL FACTURA",
    "41,269,391.77",
    "TOTAL A PAGAR $ 41,269,391.77 TOTAL A PAGAR $ 41,269,391.77",
    "VENCIMIENTO 21/09/26 VENCIMIENTO 21/09/26",
  ];

  it("lee los millones y no 177", () => {
    expect(leerCabeceraDelTexto(COOPELECTRIC, DEL_GRUPO).parcial.importeTotal).toBe(41269391.77);
  });

  it("la fecha de emisión, con el código pegado atrás", () => {
    expect(leerCabeceraDelTexto(COOPELECTRIC, DEL_GRUPO).parcial.fecha).toBe("2026-09-14");
  });
});

describe("ERGUY: la fila dice TOTAL: y el número está abajo", () => {
  const ERGUY = [
    "FECHA : 1/9/2026",
    "C.U.I.T.: 20-36745118-2",
    "FACTURA Nº 0001-00012278",
    "CUIT: 30-70728500-8",
    "Código Cantidad Descripción P. Unitario P. Total",
    "7792261031833 3,5 VENIER ESMALTE 3 EN 1 SEC.RÁP. NEGRO X 400ML $4.697,62 $16.441,67",
    "SUBTOTAL: 35.654,26",
    "TOTAL:",
    "$ 43.141,65",
    "ORIGINAL CAE: 86351028531697 FECHA VENC. CAE: 11/9/2026",
  ];

  it("toma el total de la fila de abajo y no el subtotal", () => {
    expect(leerCabeceraDelTexto(ERGUY, DEL_GRUPO).parcial.importeTotal).toBe(43141.65);
  });

  /*
   * `P. Total` también es un encabezado sin números, y su fila de abajo trae los
   * importes de la primera línea. No molesta porque gana el mayor — pero si
   * alguna vez molestara, es acá donde se vería.
   */
  it("el encabezado de la tabla no le gana al total", () => {
    expect(leerCabeceraDelTexto(ERGUY, DEL_GRUPO).parcial.importeTotal).not.toBe(16441.67);
  });

  it("no confunde la fecha del CAE con la de emisión", () => {
    expect(leerCabeceraDelTexto(ERGUY, DEL_GRUPO).parcial.fecha).toBe("2026-09-01");
  });
});

describe("BER IMPORT: la fecha viene al final de una fila larga", () => {
  const BER = [
    "Cond. IVA: IVA Responsable Inscripto FACTURA A Fecha emisión: 04/09/2026",
    "C.U.I.T.: 30-71721420-6",
    "Comprobante Nº 0005-00000262",
    "CUIT: 30-64106801-9",
    "Subtotal: $ 189.240,00",
    "IMPORTE TOTAL: $ 228.980,40",
  ];

  it("la encuentra", () => {
    expect(leerCabeceraDelTexto(BER, DEL_GRUPO).parcial.fecha).toBe("2026-09-04");
  });

  it("y el importe sigue saliendo de su propia fila", () => {
    expect(leerCabeceraDelTexto(BER, DEL_GRUPO).parcial.importeTotal).toBe(228980.4);
  });
});

describe("los dos formatos de número conviven en la misma carpeta", () => {
  const conTotal = (n: string) => leerCabeceraDelTexto([`TOTAL: ${n}`], DEL_GRUPO).parcial.importeTotal;

  it("a la argentina", () => {
    expect(conTotal("1.774.706,10")).toBe(1774706.1);
    expect(conTotal("35.654,26")).toBe(35654.26);
    expect(conTotal("1774706,10")).toBe(1774706.1);
  });

  it("a la inglesa", () => {
    expect(conTotal("1,699,556.67")).toBe(1699556.67);
    expect(conTotal("41,269,391.77")).toBe(41269391.77);
    expect(conTotal("1774706.10")).toBe(1774706.1);
  });

  /*
   * El caso que rompía: sin decidir cuál es el separador decimal, de
   * `41,269,391.77` salía `1.77` y de ahí 177.
   */
  it("un importe chico no se confunde con el final de uno grande", () => {
    expect(conTotal("1.77")).toBe(1.77);
    expect(conTotal("41,269,391.77")).not.toBe(177);
  });
});

/*
 * AGROINGA separa los miles con ESPACIOS. Lo encontró el control del banco
 * comparando el texto contra el QR de la misma factura: el QR decía
 * 1.586.745,60 y el texto devolvía 745,60. No fallaba — devolvía mil veces
 * menos, que es la clase de error que nadie mira dos veces.
 */
describe("AGROINGA: los miles separados con espacios", () => {
  const conTotal = (n: string) => leerCabeceraDelTexto([`TOTAL ${n}`], DEL_GRUPO).parcial.importeTotal;

  it("lee el número entero y no el último grupo", () => {
    expect(conTotal("1 586 745.60")).toBe(1586745.6);
  });

  it("también con el espacio duro, que es el que suele poner un PDF", () => {
    expect(conTotal("1\u00A0586\u00A0745.60")).toBe(1586745.6);
  });

  /*
   * El borde: el grupo tiene que ser de tres dígitos exactos. Si no, una
   * cantidad y un precio de dos columnas distintas se pegarían en un número que
   * no existe.
   */
  it("no junta dos columnas que no son un solo número", () => {
    expect(conTotal("5 10.00")).toBe(10);
    expect(conTotal("35 2 47.50")).toBe(47.5);
  });
});
