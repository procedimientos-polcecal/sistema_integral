import { describe, it, expect } from "vitest";
import { escalaDeLaEpoca, escalaDelValor, CORTE_DE_PLANILLA } from "./escala";

describe("escalaDeLaColumna", () => {
  it("una columna sin % es absoluto", () => {
    expect(escalaDeLaEpoca("Peso volumétrico (g/l)", [900, 1000])).toBe("absoluto");
    expect(escalaDeLaEpoca("Cal (Ton)", [12])).toBe("absoluto");
  });

  it("la humedad es fraccion siempre, haya o no valores previos", () => {
    // Nunca cambió: 0,0043 ≈ 0,43% de punta a punta del archivo.
    expect(escalaDeLaEpoca("Humedad bh (%)", [])).toBe("fraccion");
    expect(escalaDeLaEpoca("Humedad bh (%)", [0.004])).toBe("fraccion");
  });

  it("con valores previos todos menores a 1, es fraccion", () => {
    expect(escalaDeLaEpoca("Acumulado en #200 (%)", [0.1, 0.17, 0.04])).toBe("fraccion");
  });

  it("sin valores en esa epoca es porcentaje", () => {
    // Ret #200 no existía antes del corte. Tratarla como fracción convierte un
    // 19,3 en 1930, que es el error que apareció al escribir el spec.
    expect(escalaDeLaEpoca("Ret #200(%)", [])).toBe("porcentaje");
  });

  it("una columna nacida DESPUES del corte tambien puede ser fraccion", () => {
    // `Despachos cal fillerizada` arranca el 08/07/2026 —después del cambio de
    // planilla— y aun así escribe `Cal (%) = 0,81`, que son 81%. La época no
    // decide la escala: la deciden los valores de esa época.
    expect(escalaDeLaEpoca("Cal (%)", [0.81, 0.87, 0.86])).toBe("fraccion");
  });

  it("un valor exactamente 1 antes del corte deja la columna en porcentaje", () => {
    // La regla dice "todos menores a 1". Queda fijado a propósito: si algún día
    // aparece un 1,0 que era una fracción, este test lo hace visible.
    expect(escalaDeLaEpoca("Ret #100 (%)", [0.05, 1])).toBe("porcentaje");
  });
});

describe("escalaDelValor", () => {
  it("devuelve la escala de la epoca que le toca", () => {
    // El corte ya lo aplicó quien eligió la época: acá sólo se respeta.
    expect(escalaDelValor("porcentaje", CORTE_DE_PLANILLA)).toBe("porcentaje");
    expect(escalaDelValor("fraccion", "2026-05-04")).toBe("fraccion");
  });

  it("absoluto no depende de la fecha", () => {
    expect(escalaDelValor("absoluto", "2023-11-14")).toBe("absoluto");
    expect(escalaDelValor("absoluto", "2026-10-07")).toBe("absoluto");
  });

  it("la humedad NO cambia en el corte: es fraccion siempre", () => {
    // El corte movió los retenidos y los acumulados, no la humedad. Sin esta
    // excepción, 251 humedades posteriores a junio quedan etiquetadas como
    // porcentaje y un 0,0102 se lee como 0,01% en vez de 1,02%.
    expect(escalaDelValor("porcentaje", "2026-10-07", "Humedad bh (%)")).toBe("fraccion");
    expect(escalaDelValor("porcentaje", "2026-10-07", "Acumulado en #200 (%)")).toBe("porcentaje");
  });

  it("porcentaje sigue siendo porcentaje antes del corte", () => {
    // Una columna que nació después no deja de ser porcentaje por la fecha.
    expect(escalaDelValor("porcentaje", "2024-01-01")).toBe("porcentaje");
  });
});
