import { describe, it, expect } from "vitest";
import { pagaDe } from "./sheets";

/**
 * Qué dice la planilla sobre quién paga. La distinción que importa es entre
 * "la celda está vacía" (`null`, nadie decidió) y "la planilla dice algo"
 * (un objeto, aunque sea "ninguna de las dos"): antes las dos devolvían
 * `{empresa: null, ambas: false}` y la fusión con lo que ya había no podía
 * distinguirlas, así que una celda vacía borraba la empresa que había elegido
 * quien pidió.
 */
describe("quién paga, según la planilla", () => {
  it("la celda vacía es 'no dijo nada', no una decisión", () => {
    expect(pagaDe("")).toBeNull();
    expect(pagaDe(null)).toBeNull();
    expect(pagaDe("   ")).toBeNull();
  });

  it("AMBAS reparte el gasto entre las dos empresas", () => {
    expect(pagaDe("AMBAS")).toEqual({ empresa: null, ambas: true });
  });

  it("nombra la empresa que paga", () => {
    expect(pagaDe("POLCECAL")).toEqual({ empresa: "POLCECAL", ambas: false });
    expect(pagaDe("POLYSAN")).toEqual({ empresa: "POLYSAN", ambas: false });
  });

  it("tolera minúsculas y espacios como el resto de la planilla", () => {
    expect(pagaDe("  polcecal  ")).toEqual({ empresa: "POLCECAL", ambas: false });
  });

  it("un valor que no reconoce es una decisión igual, no vacío", () => {
    // A diferencia de la celda vacía, esto SÍ es un objeto: la fusión lo va a
    // tratar como "la planilla dijo algo" aunque no se entienda qué empresa.
    expect(pagaDe("otra cosa")).toEqual({ empresa: null, ambas: false });
  });
});
