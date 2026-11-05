import { describe, expect, it } from "vitest";
import { cuantasTolerancias, estadoDeRecurso, type CorridaLeida } from "./saludDeLasSincronizaciones";

const AHORA = new Date("2026-11-05T12:00:00Z");
const hace = (horas: number) => new Date(AHORA.getTime() - horas * 3_600_000).toISOString();
const corrida = (p: Partial<CorridaLeida>): CorridaLeida => ({
  modulo: "cantera",
  recurso: "acarreo",
  ok: true,
  error: null,
  created_at: hace(1),
  ...p,
});

describe("estadoDeRecurso", () => {
  it("sin fila es 'nunca'", () => expect(estadoDeRecurso(undefined, 24, AHORA)).toBe("nunca"));

  it("la última falló es 'fallo'", () =>
    expect(estadoDeRecurso(corrida({ ok: false, error: "x" }), 24, AHORA)).toBe("fallo"));

  it("dentro de la tolerancia es 'sana'", () =>
    expect(estadoDeRecurso(corrida({ created_at: hace(23) }), 24, AHORA)).toBe("sana"));

  it("pasada la tolerancia es 'vieja'", () =>
    expect(estadoDeRecurso(corrida({ created_at: hace(25) }), 24, AHORA)).toBe("vieja"));

  it("una fecha ilegible NO cuenta como sana", () =>
    expect(estadoDeRecurso(corrida({ created_at: "no es una fecha" }), 24, AHORA)).toBe("vieja"));

  it("un fallo viejo se nombra por el fallo y no por la edad", () =>
    expect(estadoDeRecurso(corrida({ ok: false, created_at: hace(99) }), 24, AHORA)).toBe("fallo"));
});

describe("cuantasTolerancias", () => {
  it("recién caído es 1", () =>
    expect(cuantasTolerancias(corrida({ created_at: hace(25) }), 24, AHORA)).toBe(1));

  it("crece con el silencio, para que el descarte se suelte", () =>
    expect(cuantasTolerancias(corrida({ created_at: hace(73) }), 24, AHORA)).toBe(3));

  it("un fallo reciente también es al menos 1", () =>
    expect(cuantasTolerancias(corrida({ ok: false, created_at: hace(1) }), 24, AHORA)).toBe(1));

  it("sin fila es 1", () => expect(cuantasTolerancias(undefined, 24, AHORA)).toBe(1));

  it("una fecha ilegible es 1 y no NaN", () =>
    expect(cuantasTolerancias(corrida({ created_at: "no es una fecha" }), 24, AHORA)).toBe(1));
});
