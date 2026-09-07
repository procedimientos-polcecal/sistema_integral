import { describe, it, expect } from "vitest";
import { fechaDeSheets } from "./fechaDeSheets";

describe("la fecha que devuelve una planilla", () => {
  it("un serial de Sheets es el dia que representa", () => {
    // 45000 = 2023-03-15. El origen de Sheets es 1899-12-30.
    expect(fechaDeSheets(45000)).toBe("2023-03-15");
  });

  /**
   * Es la regla que dio vuelta 885 fechas en Compras: el texto de una planilla
   * argentina viene d/m, y leerlo como m/d cambia el dato sin romper nada.
   */
  it("el texto se lee d/m y nunca m/d", () => {
    expect(fechaDeSheets("3/9/2026")).toBe("2026-09-03");
    expect(fechaDeSheets("13/9/2026")).toBe("2026-09-13");
  });

  it("un ISO se devuelve tal cual", () => {
    expect(fechaDeSheets("2026-09-03")).toBe("2026-09-03");
  });

  it("lo que no es una fecha es null, no hoy", () => {
    expect(fechaDeSheets("")).toBeNull();
    expect(fechaDeSheets(null)).toBeNull();
    expect(fechaDeSheets(undefined)).toBeNull();
    expect(fechaDeSheets("sin fecha")).toBeNull();
  });
});
