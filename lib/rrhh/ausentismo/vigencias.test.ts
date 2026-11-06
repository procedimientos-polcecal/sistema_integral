import { describe, expect, it } from "vitest";
import {
  horasValidas,
  primeraQueSeSuperpone,
  problemasDeLaVigencia,
  seSuperponen,
  MAXIMO_DE_HORAS,
} from "./vigencias";

describe("seSuperponen", () => {
  it("dos rangos que comparten un día se superponen, con los extremos inclusivos", () => {
    expect(seSuperponen({ desde: "2026-01-01", hasta: "2026-03-31" }, { desde: "2026-03-31", hasta: null })).toBe(true);
  });

  it("el día siguiente ya no", () => {
    expect(seSuperponen({ desde: "2026-01-01", hasta: "2026-03-31" }, { desde: "2026-04-01", hasta: null })).toBe(false);
  });

  it("dos sin fin siempre se superponen", () => {
    expect(seSuperponen({ desde: "2026-01-01", hasta: null }, { desde: "2030-01-01", hasta: null })).toBe(true);
  });

  it("una que termina antes de que empiece la otra no, en cualquiera de los dos órdenes", () => {
    const a = { desde: "2026-01-01", hasta: "2026-01-31" };
    const b = { desde: "2026-02-10", hasta: "2026-02-20" };
    expect(seSuperponen(a, b)).toBe(false);
    expect(seSuperponen(b, a)).toBe(false);
  });

  it("uno contenido entero dentro de otro se superpone", () => {
    expect(seSuperponen({ desde: "2026-01-01", hasta: null }, { desde: "2026-05-01", hasta: "2026-05-31" })).toBe(true);
  });
});

describe("primeraQueSeSuperpone", () => {
  it("devuelve la fila que choca, para poder decir cuál es", () => {
    const filas = [
      { id: "a", desde: "2025-01-01", hasta: "2025-12-31" },
      { id: "b", desde: "2026-01-01", hasta: null },
    ];
    expect(primeraQueSeSuperpone(filas, { desde: "2026-06-01", hasta: null })?.id).toBe("b");
    expect(primeraQueSeSuperpone(filas, { desde: "2024-01-01", hasta: "2024-12-31" })).toBeUndefined();
  });
});

describe("horasValidas", () => {
  it("acepta un número positivo, y un texto numérico con punto", () => {
    expect(horasValidas(200)).toBe(200);
    expect(horasValidas("208")).toBe(208);
    expect(horasValidas(7.5)).toBe(7.5);
  });

  it.each([0, -8, NaN, Infinity, "", "  ", "abc", "7,5", null, undefined, true, MAXIMO_DE_HORAS + 1])(
    "rechaza %s",
    (x) => {
      expect(horasValidas(x)).toBeNull();
    },
  );

  it("el tope mismo vale", () => {
    expect(horasValidas(MAXIMO_DE_HORAS)).toBe(MAXIMO_DE_HORAS);
  });
});

describe("problemasDeLaVigencia", () => {
  it("una vigencia buena no tiene problemas", () => {
    expect(problemasDeLaVigencia({ horas: 200, desde: "2026-01-01", hasta: null })).toEqual([]);
    expect(problemasDeLaVigencia({ horas: "200", desde: "2026-01-01", hasta: "2026-12-31" })).toEqual([]);
  });

  it("dice todos los problemas juntos y en castellano, no de a uno", () => {
    const p = problemasDeLaVigencia({ horas: -1, desde: "ayer", hasta: "mañana" });
    expect(p).toHaveLength(3);
    expect(p[0]).toMatch(/horas por empleado/);
    expect(p[1]).toMatch(/desde/);
    expect(p[2]).toMatch(/hasta/);
  });

  it("un rango invertido es un problema", () => {
    const p = problemasDeLaVigencia({ horas: 200, desde: "2026-06-01", hasta: "2026-05-31" });
    expect(p).toEqual(["La fecha hasta no puede ser anterior a la fecha desde."]);
  });

  it("una fecha que no existe en el calendario no pasa", () => {
    expect(problemasDeLaVigencia({ horas: 200, desde: "2026-02-30", hasta: null })).toHaveLength(1);
  });
});
