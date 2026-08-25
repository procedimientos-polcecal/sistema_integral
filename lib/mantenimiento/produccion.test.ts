import { describe, it, expect } from "vitest";
import {
  lunesDe, diasDeLaSemana, normalizarSemana, ESTADOS_PRODUCCION, TURNOS, diasLibres,
} from "./produccion";

/**
 * El lunes se calcula con las partes locales de la fecha, no con toISOString():
 * en un servidor en UTC, la medianoche local de un huso positivo cae el dia
 * anterior y la semana entera se corre.
 */
describe("el lunes de la semana", () => {
  it("de un miercoles devuelve el lunes anterior", () => {
    expect(lunesDe(new Date(2026, 7, 26))).toBe("2026-08-24");
  });

  it("de un lunes devuelve ese mismo lunes", () => {
    expect(lunesDe(new Date(2026, 7, 24))).toBe("2026-08-24");
  });

  it("de un domingo devuelve el lunes de esa semana, no el siguiente", () => {
    expect(lunesDe(new Date(2026, 7, 30))).toBe("2026-08-24");
  });

  it("cruza el fin de mes sin romperse", () => {
    expect(lunesDe(new Date(2026, 8, 2))).toBe("2026-08-31");
  });
});

describe("los siete dias de la semana", () => {
  it("van de lunes a domingo", () => {
    const dias = diasDeLaSemana("2026-08-24");
    expect(dias).toHaveLength(7);
    expect(dias[0]).toBe("2026-08-24");
    expect(dias[6]).toBe("2026-08-30");
  });

  it("cruza el cambio de mes", () => {
    expect(diasDeLaSemana("2026-08-31")[6]).toBe("2026-09-06");
  });
});

describe("normalizar lo que llega de la pantalla", () => {
  it("siempre son siete valores", () => {
    expect(normalizarSemana(["LIBRE"], ESTADOS_PRODUCCION, "LIBRE")).toHaveLength(7);
    expect(normalizarSemana(undefined, ESTADOS_PRODUCCION, "LIBRE")).toHaveLength(7);
  });

  it("un valor que no existe cae en el por defecto", () => {
    const r = normalizarSemana(["EN_PRODUCCION", "CUALQUIERA"], ESTADOS_PRODUCCION, "LIBRE");
    expect(r[0]).toBe("EN_PRODUCCION");
    expect(r[1]).toBe("LIBRE");
  });

  it("de mas se recorta a siete", () => {
    const ocho = Array(8).fill("PARCIAL");
    expect(normalizarSemana(ocho, ESTADOS_PRODUCCION, "LIBRE")).toHaveLength(7);
  });
});

describe("que dias queda libre un sector", () => {
  it("libre es el dia que ningun registro ocupa", () => {
    const libres = diasLibres([
      { days: ["LIBRE", "EN_PRODUCCION", "LIBRE", "PARCIAL", "LIBRE", "LIBRE", "LIBRE"] },
    ]);
    expect(libres).toEqual([true, false, true, false, true, true, true]);
  });

  it("con varios sectores, alcanza que uno produzca para que el dia no este libre", () => {
    const libres = diasLibres([
      { days: ["LIBRE", "LIBRE", "LIBRE", "LIBRE", "LIBRE", "LIBRE", "LIBRE"] },
      { days: ["EN_PRODUCCION", "LIBRE", "LIBRE", "LIBRE", "LIBRE", "LIBRE", "LIBRE"] },
    ]);
    expect(libres[0]).toBe(false);
    expect(libres[1]).toBe(true);
  });

  it("sin registros, la semana entera esta libre", () => {
    expect(diasLibres([])).toEqual([true, true, true, true, true, true, true]);
  });
});

describe("los turnos", () => {
  it("son manana, tarde y noche", () => {
    expect(TURNOS.map((t) => t.valor)).toEqual(["M", "T", "N"]);
  });
});
