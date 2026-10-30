import { describe, it, expect } from "vitest";
import { escalaDeLaColumna, escalaDelValor, CORTE_DE_PLANILLA } from "./escala";

describe("escalaDeLaColumna", () => {
  it("una columna sin % es absoluto", () => {
    expect(escalaDeLaColumna("Peso volumétrico (g/l)", [900, 1000])).toBe("absoluto");
    expect(escalaDeLaColumna("Cal (Ton)", [12])).toBe("absoluto");
  });

  it("la humedad es fraccion siempre, haya o no valores previos", () => {
    // Nunca cambió: 0,0043 ≈ 0,43% de punta a punta del archivo.
    expect(escalaDeLaColumna("Humedad bh (%)", [])).toBe("fraccion");
    expect(escalaDeLaColumna("Humedad bh (%)", [0.004])).toBe("fraccion");
  });

  it("con valores previos todos menores a 1, es fraccion", () => {
    expect(escalaDeLaColumna("Acumulado en #200 (%)", [0.1, 0.17, 0.04])).toBe("fraccion");
  });

  it("sin valores previos es porcentaje: la columna nacio con la planilla nueva", () => {
    // Ret #50, Ret #200 y Ret #325 están en este caso. Tratarlas como fracción
    // convierte un 19,3 en 1930, que es el error que apareció al escribir el
    // spec.
    expect(escalaDeLaColumna("Ret #200(%)", [])).toBe("porcentaje");
  });

  it("un valor exactamente 1 antes del corte deja la columna en porcentaje", () => {
    // La regla dice "todos menores a 1". Queda fijado a propósito: si algún día
    // aparece un 1,0 que era una fracción, este test lo hace visible.
    expect(escalaDeLaColumna("Ret #100 (%)", [0.05, 1])).toBe("porcentaje");
  });
});

describe("escalaDelValor", () => {
  it("una columna fraccion es porcentaje desde el corte", () => {
    expect(escalaDelValor("fraccion", CORTE_DE_PLANILLA)).toBe("porcentaje");
    expect(escalaDelValor("fraccion", "2026-05-04")).toBe("fraccion");
  });

  it("absoluto no depende de la fecha", () => {
    expect(escalaDelValor("absoluto", "2023-11-14")).toBe("absoluto");
    expect(escalaDelValor("absoluto", "2026-10-07")).toBe("absoluto");
  });

  it("porcentaje sigue siendo porcentaje antes del corte", () => {
    // Una columna que nació después no deja de ser porcentaje por la fecha.
    expect(escalaDelValor("porcentaje", "2024-01-01")).toBe("porcentaje");
  });
});
