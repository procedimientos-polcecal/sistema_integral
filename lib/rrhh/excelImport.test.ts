import { describe, it, expect } from "vitest";
import { parseDateString, parseMarcaciones, parseNumeroAR } from "./excelImport";

describe("parseDateString", () => {
  it("interpreta DD/MM/YYYY con prefijo de día de semana (formato reloj)", () => {
    const d = parseDateString("Lu 01/06/2026");
    expect(d?.getUTCFullYear()).toBe(2026);
    expect(d?.getUTCMonth()).toBe(5); // junio = índice 5
    expect(d?.getUTCDate()).toBe(1);
  });

  it("interpreta DD/MM/YYYY sin prefijo", () => {
    const d = parseDateString("25/12/2026");
    expect(d?.getUTCMonth()).toBe(11);
    expect(d?.getUTCDate()).toBe(25);
  });

  it("interpreta ISO YYYY-MM-DD", () => {
    const d = parseDateString("2026-07-09");
    expect(d?.getUTCMonth()).toBe(6);
    expect(d?.getUTCDate()).toBe(9);
  });
});

describe("parseMarcaciones", () => {
  it("interpreta un par entrada/salida simple", () => {
    const pares = parseMarcaciones("E 08:07 - S 15:56");
    expect(pares).toEqual([{ entradaStr: "08:07", salidaStr: "15:56" }]);
  });

  it("interpreta varios tramos (corte de almuerzo)", () => {
    const pares = parseMarcaciones("E 08:00 - S 12:00  E 13:00 - S 17:00");
    expect(pares).toEqual([
      { entradaStr: "08:00", salidaStr: "12:00" },
      { entradaStr: "13:00", salidaStr: "17:00" },
    ]);
  });

  it("marca como abierta una entrada sin salida (marcación faltante)", () => {
    const pares = parseMarcaciones("E 08:07");
    expect(pares).toEqual([{ entradaStr: "08:07", salidaStr: null }]);
  });

  it("cadena vacía no produce marcaciones", () => {
    expect(parseMarcaciones("")).toEqual([]);
  });
});

describe("parseNumeroAR", () => {
  it("interpreta formato argentino con miles y decimales", () => {
    expect(parseNumeroAR("3.500,50")).toBeCloseTo(3500.5);
  });
  it("interpreta formato argentino solo con decimales", () => {
    expect(parseNumeroAR("3500,5")).toBeCloseTo(3500.5);
  });
  it("interpreta número plano", () => {
    expect(parseNumeroAR("3500")).toBe(3500);
    expect(parseNumeroAR(3500)).toBe(3500);
  });
});
