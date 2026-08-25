import { describe, it, expect } from "vitest";
import { fechaDeSheets, codigoDeEquipo } from "./planilla";

/**
 * La planilla se lee sin formato, asi que las fechas llegan como serial de
 * Sheets. El texto formateado depende del locale de la planilla, y confundir
 * el dia con el mes ya costo corregir 885 registros en Compras.
 */
describe("fechas de la planilla de avisos", () => {
  it("convierte el serial de Sheets", () => {
    // 45992 = 2025-12-01
    expect(fechaDeSheets(45992)).toBe("2025-12-01");
  });

  it("acepta texto d/m/aaaa como respaldo", () => {
    expect(fechaDeSheets("1/12/2025")).toBe("2025-12-01");
    expect(fechaDeSheets("25/8/2026")).toBe("2026-08-25");
  });

  it("acepta ISO", () => {
    expect(fechaDeSheets("2026-08-25")).toBe("2026-08-25");
  });

  it("lo que no es una fecha no se inventa", () => {
    expect(fechaDeSheets("")).toBeNull();
    expect(fechaDeSheets(null)).toBeNull();
    expect(fechaDeSheets("proximamente")).toBeNull();
  });
});

describe("codigo del equipo dentro del texto", () => {
  it("lo saca de un texto que lo trae adelante", () => {
    expect(codigoDeEquipo("PO-A1-01 Compresor A1")).toBe("PO-A1-01");
  });

  it("tolera parentesis y separadores", () => {
    expect(codigoDeEquipo("Compresor (PO-A1-01)")).toBe("PO-A1-01");
    expect(codigoDeEquipo("PO-A1-01 - Compresor")).toBe("PO-A1-01");
  });

  it("sin codigo devuelve null", () => {
    expect(codigoDeEquipo("Compresor grande")).toBeNull();
    expect(codigoDeEquipo("")).toBeNull();
  });
});
