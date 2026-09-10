import { describe, it, expect } from "vitest";
import { leerQrAfip } from "./qrAfip";

/**
 * El payload de ejemplo sigue la especificación pública de ARCA. Los valores
 * son los de una factura A del RI 1933 —Casa Camino, $39.022,50— para que los
 * tests hablen de algo reconocible.
 *
 * Ojo: el formato **no está confirmado contra una factura real del grupo**. Por
 * eso hay tests que fijan el comportamiento cuando el JSON no es el esperado:
 * eso es lo que va a pasar si la suposición estuviera mal, y tiene que ser
 * legible en vez de romper.
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

  it("un `p` que no es base64 de un JSON lo dice", () => {
    const r = leerQrAfip("https://www.arca.gob.ar/fe/qr/?p=esto-no-es-base64-de-un-json");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("base64");
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
