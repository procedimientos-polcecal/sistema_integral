import { describe, it, expect } from "vitest";
import { fechaDeSheets, serialDelDia, serialDelInstante } from "./fechaDeSheets";

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

describe("la fecha como la guarda Sheets", () => {
  it("un dia es un serial entero", () => {
    // Verificado contra la planilla real: la fila del RI 1954 tiene 46275 en
    // "PARA CUANDO SE NECESITA" y se ve como 10/9/2026.
    expect(serialDelDia("2026-09-10")).toBe(46275);
  });

  it("y vuelve igual: es la inversa de fechaDeSheets", () => {
    for (const iso of ["2026-09-10", "2026-01-01", "2025-12-31", "1970-01-01"]) {
      expect(fechaDeSheets(serialDelDia(iso))).toBe(iso);
    }
  });

  it("un instante lleva la fraccion del dia, en la zona de la planilla", () => {
    // La planilla esta en America/Araguaina (UTC-3), como Argentina y sin
    // horario de verano. 12:36:57 UTC son las 09:36:57 alla.
    const serial = serialDelInstante(new Date("2026-09-09T12:36:57.702Z"));
    expect(Math.floor(serial)).toBe(46274);
    expect(serial).toBeCloseTo(46274.40066, 4);
  });

  it("una fecha que no se entiende no inventa un numero", () => {
    expect(serialDelDia("")).toBeNull();
    expect(serialDelDia("10/9/2026")).toBeNull();
  });
});
