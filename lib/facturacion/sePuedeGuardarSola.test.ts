import { describe, expect, it } from "vitest";
import { sePuedeGuardarSola, type LoLeido } from "./sePuedeGuardarSola";
import type { LecturaDeFactura } from "./leerArchivo";

/** Una lectura limpia de QR: lo que pasa el 98% de las veces. */
function leida(cambios: Partial<LecturaDeFactura> = {}): LecturaDeFactura {
  return {
    cabecera: {
      cuitEmisor: "20162711491",
      cuitReceptor: "30641068019",
      tipoComprobante: 11,
      puntoVenta: 3,
      numero: 108,
      fecha: "2026-10-06",
      importeTotal: 1682296.5,
    },
    origenDeLaCabecera: "qr",
    avisoDelImporte: null,
    ...cambios,
  } as unknown as LecturaDeFactura;
}

const bien: LoLeido = { lectura: leida(), empresaReconocida: true };

describe("lo que se guarda solo", () => {
  it("QR limpio, importe que coincide y empresa reconocida", () => {
    expect(sePuedeGuardarSola(bien)).toEqual({ sola: true });
  });
});

describe("lo que queda para que lo mire una persona", () => {
  /*
   * El escaneo sin capa de texto: 84 de los 398 pendientes del 29/10/2026.
   */
  it("sin cabecera, que es el escaneo", () => {
    const r = sePuedeGuardarSola({ lectura: leida({ cabecera: null } as never), empresaReconocida: true });
    expect(r.sola).toBe(false);
    expect(r.sola === false && r.porque).toContain("cabecera");
  });

  it("y tampoco si no se pudo leer el archivo", () => {
    expect(sePuedeGuardarSola({ lectura: null, empresaReconocida: true }).sola).toBe(false);
  });

  /*
   * El QR está firmado por ARCA; el texto lo interpretó un lector sobre lo que
   * imprimió el emisor. Los dos entran al buzón, pero sólo uno se da por bueno
   * sin que nadie lo mire.
   */
  it("si los datos salieron del texto impreso y no del QR", () => {
    const r = sePuedeGuardarSola({
      lectura: leida({ origenDeLaCabecera: "texto" }),
      empresaReconocida: true,
    });
    expect(r.sola).toBe(false);
    expect(r.sola === false && r.porque).toContain("texto impreso");
  });

  /*
   * Hay emisores que mandan el importe del QR en centavos: el que se guardaría
   * es cien veces más grande que el del papel. Es justo lo que no puede pasar
   * en una corrida de veinticinco.
   */
  it("si el importe del QR no coincide con el impreso", () => {
    const r = sePuedeGuardarSola({
      lectura: leida({ avisoDelImporte: { texto: "El QR dice 168.229.650 y lo impreso 1.682.296,50" } } as never),
      empresaReconocida: true,
    });
    expect(r.sola).toBe(false);
    expect(r.sola === false && r.porque).toContain("168.229.650");
  });

  it("si el comprobante no está emitido a ninguna de las dos empresas", () => {
    const r = sePuedeGuardarSola({ lectura: leida(), empresaReconocida: false });
    expect(r.sola).toBe(false);
    expect(r.sola === false && r.porque).toContain("Polcecal");
  });
});

/*
 * Las cuatro son conjuntas: con que falte una no se guarda sola. No se guarda
 * a medias ni se completa con un valor por defecto.
 */
describe("son conjuntas", () => {
  it("con dos problemas a la vez sigue siendo no", () => {
    const r = sePuedeGuardarSola({
      lectura: leida({ origenDeLaCabecera: "texto" }),
      empresaReconocida: false,
    });
    expect(r.sola).toBe(false);
  });
});
