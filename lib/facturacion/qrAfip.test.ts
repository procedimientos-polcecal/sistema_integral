import { describe, it, expect } from "vitest";
import { leerQrAfip } from "./qrAfip";

/**
 * El payload sintético sirve para los casos de borde; los reales están al final
 * del archivo, y son los que mandan.
 *
 * El formato quedó **confirmado contra tres facturas del grupo el 10/09/2026**:
 * los trece nombres de campo son los que usa el emisor de TORRACO. Lo que las
 * facturas reales agregaron es que no se puede suponer que el QR sea válido —hay
 * uno con coma decimal y truncado a 255 caracteres— ni que el base64 venga en
 * una sola línea.
 */
function qrCon(datos: Record<string, unknown>, host = "https://www.arca.gob.ar/fe/qr/"): string {
  const json = JSON.stringify(datos);
  const base64 = Buffer.from(json, "utf8").toString("base64");
  return `${host}?p=${encodeURIComponent(base64)}`;
}

const FACTURA = {
  ver: 1,
  fecha: "2026-09-10",
  cuit: 30710976356,
  ptoVta: 4,
  tipoCmp: 1,
  nroCmp: 12345,
  importe: 39022.5,
  moneda: "PES",
  ctz: 1,
  tipoDocRec: 80,
  nroDocRec: 30500000001,
  tipoCodAut: "E",
  codAut: 74123456789012,
};

describe("leer el QR de una factura", () => {
  it("saca la cabecera completa", () => {
    const r = leerQrAfip(qrCon(FACTURA));
    if (!r.ok) throw new Error(r.motivo);

    expect(r.cabecera).toEqual({
      version: 1,
      fecha: "2026-09-10",
      cuitEmisor: "30710976356",
      puntoVenta: 4,
      tipoComprobante: 1,
      numero: 12345,
      importeTotal: 39022.5,
      moneda: "PES",
      cotizacion: 1,
      cuitReceptor: "30500000001",
      tipoDocReceptor: 80,
      cae: "74123456789012",
      tipoCae: "E",
      reparado: false,
    });
  });

  /*
   * AFIP pasó a llamarse ARCA y el dominio del QR cambió. Rechazar por el host
   * sería rechazar todas las facturas emitidas antes del cambio.
   */
  it("acepta el dominio viejo de AFIP y el nuevo de ARCA", () => {
    for (const host of [
      "https://www.afip.gob.ar/fe/qr/",
      "https://www.arca.gob.ar/fe/qr/",
      "https://servicioscf.afip.gob.ar/publico/comprobantes/cae.aspx",
    ]) {
      const r = leerQrAfip(qrCon(FACTURA, host));
      expect(r.ok, host).toBe(true);
    }
  });

  it("acepta el base64 pelado, sin URL", () => {
    const base64 = Buffer.from(JSON.stringify(FACTURA), "utf8").toString("base64");
    const r = leerQrAfip(base64);
    expect(r.ok).toBe(true);
  });

  it("aguanta el base64 url-safe y sin relleno", () => {
    const base64 = Buffer.from(JSON.stringify(FACTURA), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const r = leerQrAfip(`https://www.arca.gob.ar/fe/qr/?p=${base64}`);
    expect(r.ok).toBe(true);
  });

  it("lee los acentos del emisor sin romperse", () => {
    // `atob` a secas devuelve una cadena binaria y parte los acentos en dos.
    const r = leerQrAfip(qrCon({ ...FACTURA, razonSocial: "MARTÍNEZ e HIJOS S.A." }));
    expect(r.ok).toBe(true);
  });
});

describe("el CUIT del receptor", () => {
  it("dice a qué empresa se le facturó", () => {
    const r = leerQrAfip(qrCon(FACTURA));
    if (!r.ok) throw new Error(r.motivo);
    expect(r.cabecera.cuitReceptor).toBe("30500000001");
  });

  it("un DNI en ese campo no es una empresa: queda en null", () => {
    // tipoDocRec 96 es DNI. Tratarlo como CUIT buscaría una empresa inexistente.
    const r = leerQrAfip(qrCon({ ...FACTURA, tipoDocRec: 96, nroDocRec: 36215654 }));
    if (!r.ok) throw new Error(r.motivo);

    expect(r.cabecera.cuitReceptor).toBeNull();
    expect(r.cabecera.tipoDocReceptor).toBe(96);
  });

  it("un comprobante sin receptor tampoco rompe", () => {
    const { tipoDocRec: _t, nroDocRec: _n, ...sinReceptor } = FACTURA;
    const r = leerQrAfip(qrCon(sinReceptor));
    if (!r.ok) throw new Error(r.motivo);
    expect(r.cabecera.cuitReceptor).toBeNull();
  });
});

describe("cuando el QR no es lo que se espera", () => {
  it("un texto cualquiera se rechaza diciendo qué se leyó", () => {
    const r = leerQrAfip("https://ejemplo.com/una-pagina");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("parámetro `p`");
    expect(r.motivo).toContain("https://ejemplo.com");
  });

  it("un `p` que no lleva datos de comprobante lo dice, y muestra qué leyó", () => {
    const r = leerQrAfip("https://www.arca.gob.ar/fe/qr/?p=esto-no-es-base64-de-un-json");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("no se pudo interpretar");
  });

  /*
   * El test que más importa hoy: el formato viene de la especificación pública
   * y no está confirmado contra una factura del grupo. Si algún campo tuviera
   * otro nombre, el motivo tiene que decir **qué claves vinieron**, para que la
   * primera factura resuelva la duda en el acto.
   */
  it("si faltan campos, dice cuáles faltan Y cuáles vinieron", () => {
    const r = leerQrAfip(qrCon({ ver: 1, fecha: "2026-09-10", total: 39022.5, emisor: 30710976356 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;

    expect(r.motivo).toContain("cuit");
    expect(r.motivo).toContain("importe");
    // Y lo que sí trajo, que es la pista para corregir el lector.
    expect(r.motivo).toContain("total");
    expect(r.motivo).toContain("emisor");
  });

  it("un CUIT de emisor imposible se rechaza en vez de guardarse", () => {
    const r = leerQrAfip(qrCon({ ...FACTURA, cuit: 123 }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("once dígitos");
  });

  it("un importe que no es número se rechaza", () => {
    const r = leerQrAfip(qrCon({ ...FACTURA, importe: "treinta mil" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("importe");
  });

  it("el código vacío no es un error raro", () => {
    expect(leerQrAfip("").ok).toBe(false);
    expect(leerQrAfip("   ").ok).toBe(false);
  });
});

/*
 * ── Facturas reales, leídas el 10/09/2026 ────────────────────
 *
 * Estos dos payloads salieron de decodificar el QR de dos facturas de verdad
 * del grupo. No son ejemplos: son el contrato con el que hay que convivir, y
 * cada uno enseñó algo que la especificación no dice.
 */

/**
 * TORRACO, factura A 0005-00003733. El caso bien formado… con el base64
 * partido en líneas de 72 caracteres, que es lo que hacía perder 218 de 290.
 */
const TORRACO = "https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0wOS0wMSIsImN1aXQiOjIzMjE0ODExODM5LCJwdG9W\r\ndGEiOjUsInRpcG9DbXAiOjEsIm5yb0NtcCI6MzczMywiaW1wb3J0ZSI6MzEyMTgwMCwibW9u\r\nZWRhIjoiUEVTIiwiY3R6IjoxLCJ0aXBvRG9jUmVjIjo4MCwibnJvRG9jUmVjIjoiMzA2NDEw\r\nNjgwMTkiLCJ0aXBvQ29kQXV0IjoiRSIsImNvZEF1dCI6Ijg2MzUwODc5MzQzOTYwIn0=";

/**
 * PEDRO H. CAMINO, factura A 0005-00003317. El caso roto: coma decimal en el
 * importe, tabs de relleno, y el payload cortado en 255 caracteres por el
 * generador del emisor.
 */
const CAMINO = "https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyNi0wOS0wOSIsImN1aXQiOjMwNzEwOTc2MzU2LCJwdG9WdGEiOjUsInRpcG9DbXAiOjEsIm5yb0NtcCI6MzMxNwkJCSwiaW1wb3J0ZSI6MzgxNjYsODgsIm1vbmVkYSI6IlBFUyIsImN0eiI6MSwidGlwb0RvY1JlYyI6ODAsIm5yb0RvY1JlYyI6ODAsInRpcG";

describe("las facturas reales del grupo", () => {
  it("TORRACO: el base64 partido en líneas se lee completo", () => {
    const r = leerQrAfip(TORRACO);
    if (!r.ok) throw new Error(r.motivo);

    expect(r.cabecera).toEqual({
      version: 1,
      fecha: "2026-09-01",
      cuitEmisor: "23214811839",
      puntoVenta: 5,
      tipoComprobante: 1,
      numero: 3733,
      importeTotal: 3121800,
      moneda: "PES",
      cotizacion: 1,
      // El CUIT de POLCECAL: el QR dice a cuál de las dos empresas se le facturó.
      cuitReceptor: "30641068019",
      tipoDocReceptor: 80,
      cae: "86350879343960",
      tipoCae: "E",
      reparado: false,
    });
  });

  it("TORRACO: el número y el punto de venta son los del nombre del archivo", () => {
    // El archivo se llama "POLCECAL SA-Factura A-0005-00003733": 5 y 3733.
    const r = leerQrAfip(TORRACO);
    if (!r.ok) throw new Error(r.motivo);
    expect([r.cabecera.puntoVenta, r.cabecera.numero]).toEqual([5, 3733]);
  });

  /*
   * Este es el test que justifica el lector tolerante. El QR de esta factura
   * no es un JSON válido y está cortado a la mitad, y aun así identifica el
   * comprobante sin ambigüedad: emisor, tipo, punto de venta, número, fecha e
   * importe. Rechazarla habría sido devolverle el problema a quien la carga.
   */
  it("CAMINO: un QR inválido y truncado se lee igual, y se marca", () => {
    const r = leerQrAfip(CAMINO);
    if (!r.ok) throw new Error(r.motivo);

    expect(r.cabecera).toMatchObject({
      fecha: "2026-09-09",
      cuitEmisor: "30710976356",
      puntoVenta: 5,
      tipoComprobante: 1,
      numero: 3317,
      moneda: "PES",
      // Hubo que reparar: la pantalla lo va a mostrar.
      reparado: true,
    });
  });

  it("CAMINO: la coma decimal del emisor se lee como decimal", () => {
    // El QR dice `"importe":38166,88`, que en JSON no es un número.
    const r = leerQrAfip(CAMINO);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.cabecera.importeTotal).toBe(38166.88);
  });

  it("CAMINO: el receptor no se puede saber, y queda en null", () => {
    /*
     * El emisor escribió `"nroDocRec":80` —repitió el tipo de documento— y ahí
     * el payload se corta. No hay forma de saber a qué empresa se le facturó,
     * así que no se inventa: queda vacío y lo elige una persona.
     */
    const r = leerQrAfip(CAMINO);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.cabecera.cuitReceptor).toBeNull();
  });

  it("los dos son del mismo punto de venta y distinto emisor", () => {
    const a = leerQrAfip(TORRACO);
    const b = leerQrAfip(CAMINO);
    if (!a.ok || !b.ok) throw new Error("las dos tienen que leerse");
    expect(a.cabecera.cuitEmisor).not.toBe(b.cabecera.cuitEmisor);
  });
});
