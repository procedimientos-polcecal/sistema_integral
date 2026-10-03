import { describe, it, expect } from "vitest";
import { reconocerLaFactura } from "./correoEntrante";

const DEL_GRUPO = ["30641068019", "30707285008"];

/*
 * Textos recortados de facturas reales de la carpeta, tal como los devuelve
 * `getTextContent()` de pdf.js: todo seguido y sin renglones.
 */
const ALMENTA =
  "FACTURA Nº: 0006-00010192 A Cod.01 Fecha: 10/9/2026 C.U.I.T.: 20-16581164-0 " +
  "Señor/es: POLCECAL S.A. C.U.I.T.: 30-64106801-9 TOTAL $ 1.774.706,10";

const ZITO =
  "A Fecha de Emisión: 02/09/2026 Zito y Priola S.R.L COD.01 Factura 0027-00070568 " +
  "C.U.I.T 30-71182027-9 Razón Social: POLCECAL S.A. CUIT: 30-64106801-9";

describe("un adjunto que sí es una factura nuestra", () => {
  it("la reconoce por el CUIT del grupo más la palabra factura", () => {
    expect(reconocerLaFactura(ALMENTA, DEL_GRUPO)).toEqual({ es: "factura" });
    expect(reconocerLaFactura(ZITO, DEL_GRUPO)).toEqual({ es: "factura" });
  });

  it("el CUIT entra escrito como venga", () => {
    for (const cuit of ["30-64106801-9", "30641068019", "30 64106801 9", "30.64106801.9"]) {
      expect(reconocerLaFactura(`FACTURA 0001-00000001 CUIT: ${cuit}`, DEL_GRUPO).es).toBe(
        "factura"
      );
    }
  });

  it("también una nota de crédito o de débito", () => {
    expect(reconocerLaFactura("NOTA DE CRÉDITO CUIT 30-70728500-8 0003-00000047", DEL_GRUPO).es)
      .toBe("factura");
    expect(reconocerLaFactura("Nota de Debito CUIT 30707285008 2078-00001363", DEL_GRUPO).es)
      .toBe("factura");
  });

  /*
   * Hay emisores que no escriben la palabra "factura" en ningún lado y se
   * identifican sólo por el número. El patrón de ARCA alcanza.
   */
  it("o sólo el número con forma de comprobante", () => {
    expect(reconocerLaFactura("Comp. 0005-00003734 CUIT 30-64106801-9", DEL_GRUPO).es).toBe(
      "factura"
    );
  });
});

describe("lo que no es una factura nuestra", () => {
  /*
   * El caso que llena la bandeja si no se filtra: con la búsqueda mirando todos
   * los mails, entra cualquier PDF adjunto.
   */
  it("un presupuesto a otra empresa", () => {
    const r = reconocerLaFactura(
      "PRESUPUESTO Nº 1234 Señores: OTRA EMPRESA S.A. CUIT: 30-11111111-1",
      DEL_GRUPO
    );
    expect(r.es).toBe("no");
    expect(r.es === "no" && r.porque).toContain("CUIT de Polcecal");
  });

  it("un documento que lleva nuestro CUIT pero no es un comprobante", () => {
    const r = reconocerLaFactura(
      "CONTRATO DE LOCACIÓN entre POLCECAL S.A., CUIT 30-64106801-9, y el locador",
      DEL_GRUPO
    );
    expect(r.es).toBe("no");
    expect(r.es === "no" && r.porque).toContain("no dice ser una factura");
  });

  /*
   * Un CUIT suelto no alcanza: el patrón del número tiene bordes de palabra
   * justamente para que una tira larga de dígitos no lo imite.
   */
  it("un extracto bancario con nuestro CUIT y un CBU largo", () => {
    expect(
      reconocerLaFactura("RESUMEN DE CUENTA CUIT 30-64106801-9 CBU 01700998400000012345678", DEL_GRUPO)
        .es
    ).toBe("no");
  });
});

/*
 * El 6% medido: 20 de los 336 PDF de la carpeta son escaneos sin capa de texto
 * —DON ALFREDO, LOGÍSTICA VW, TECNICOR, GIACOMASSO— y son facturas de verdad.
 * Descartarlos sería perder veinte por mes sin que nadie se entere.
 */
describe("lo que no se puede confirmar entra igual", () => {
  it("un PDF escaneado, sin texto", () => {
    const r = reconocerLaFactura("", DEL_GRUPO);
    expect(r.es).toBe("dudoso");
    expect(r.es === "dudoso" && r.porque).toContain("escaneo");
  });

  it("un PDF con texto en blanco también", () => {
    expect(reconocerLaFactura("   \n  ", DEL_GRUPO).es).toBe("dudoso");
  });

  /*
   * Y éste es el que falta en la mitad de los sistemas: el PDF **no abrió**.
   * Entra igual, pero con el motivo de verdad y no con el del escaneo. Durante
   * una tarde los dos casos dijeron "es un escaneo" y eso tapó un bug real
   * —pdf.js rechazando un `Buffer`— en tres facturas que sí tenían texto.
   */
  it("y uno que no se pudo abrir dice por qué, sin disfrazarlo de escaneo", () => {
    const r = reconocerLaFactura({ fallo: "Invalid PDF structure." }, DEL_GRUPO);
    expect(r.es).toBe("dudoso");
    expect(r.es === "dudoso" && r.porque).toContain("Invalid PDF structure.");
    expect(r.es === "dudoso" && r.porque).not.toContain("escaneo");
  });

  it("sin CUIT del grupo configurado no se inventa un rechazo", () => {
    // Si la lista viniera vacía, todo caería como "no es nuestra" y la bandeja
    // quedaría muda. Mejor que se note acá que en producción.
    expect(reconocerLaFactura(ALMENTA, []).es).toBe("no");
  });
});
