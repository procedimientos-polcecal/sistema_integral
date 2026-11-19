import { describe, expect, it } from "vitest";
import { TOPE_DE_MUESTRAS, compararMuestras, etiquetasDeMuestras } from "./comparacion";

/** Calcio 0-2 del 27/10/2026, el mismo de `curva.test.ts`. Peso 100: los gramos son los %. */
const CALCIO = {
  id: "a",
  producto: "Calcio 0-2",
  fecha: "2026-10-27",
  observaciones: null,
  pesoMuestraG: 100,
  retenidos: [
    { malla: 6, retenido_g: 0 },
    { malla: 7, retenido_g: 0 },
    { malla: 10, retenido_g: 0.2 },
    { malla: 12, retenido_g: 0.7 },
    { malla: 20, retenido_g: 6.0 },
    { malla: 50, retenido_g: 34.7 },
    { malla: 100, retenido_g: 14.4 },
    { malla: 200, retenido_g: 10.4 },
  ],
};

/**
 * Otro juego de mallas, que es el caso que obliga a todo esto: sin #20 y con
 * #325. No es inventado: de los 8 productos con granulometría, 4 tienen
 * muestras con juegos distintos, y Filler 1 tiene tres.
 */
const FINO = {
  id: "b",
  producto: "Filler 1",
  fecha: "2026-11-03",
  observaciones: null,
  pesoMuestraG: 100,
  retenidos: [
    { malla: 50, retenido_g: 30 },
    { malla: 100, retenido_g: 20 },
    { malla: 200, retenido_g: 10 },
    { malla: 325, retenido_g: 5 },
  ],
};

describe("compararMuestras", () => {
  it("con una sola muestra el eje son sus mallas y hay una serie", () => {
    const c = compararMuestras([CALCIO], []);

    expect(c.mallas).toEqual([6, 7, 10, 12, 20, 50, 100, 200]);
    expect(c.series).toHaveLength(1);
    expect(c.filas).toHaveLength(8);
    expect(c.filas[7]).toEqual({ malla: 200, r0: 10.4, a0: 66.4, p0: 33.6 });
    expect(c.disparejas).toEqual([]);
  });

  it("el eje de dos muestras es la union de sus mallas", () => {
    const c = compararMuestras([CALCIO, FINO], []);

    expect(c.mallas).toEqual([6, 7, 10, 12, 20, 50, 100, 200, 325]);
  });

  it("la malla que una muestra no midio queda en null y no en cero", () => {
    const c = compararMuestras([CALCIO, FINO], []);

    const enVeinte = c.filas.find((f) => f.malla === 20)!;
    const en325 = c.filas.find((f) => f.malla === 325)!;
    expect(enVeinte.r0).toBe(6);
    expect(enVeinte.r1).toBeNull();
    expect(en325.r0).toBeNull();
    expect(en325.r1).toBe(5);
  });

  it("dice quien no midio que", () => {
    const c = compararMuestras([CALCIO, FINO], []);

    expect(c.disparejas).toEqual([
      { etiqueta: "Calcio 0-2 · 27/10/2026", faltan: [325] },
      { etiqueta: "Filler 1 · 03/11/2026", faltan: [6, 7, 10, 12, 20] },
    ]);
  });

  it("una malla apagada sale del eje dibujado, de los chips no, y no cuenta como despareja", () => {
    const c = compararMuestras([CALCIO, FINO], [325]);

    expect(c.mallas).toContain(325);
    expect(c.filas.some((f) => f.malla === 325)).toBe(false);
    expect(c.disparejas.find((d) => d.etiqueta.startsWith("Calcio"))).toBeUndefined();
  });

  it("apagar un tamiz no recalcula el acumulado de los que siguen", () => {
    const c = compararMuestras([CALCIO], [20]);

    const en50 = c.filas.find((f) => f.malla === 50)!;
    // Con #20 adentro. Recalcular sin ella daría 35,6, que nadie midió.
    expect(en50.a0).toBe(41.6);
  });

  it("una muestra sin granulometria no borra las demas", () => {
    const vacia = { ...FINO, id: "c", retenidos: [] };
    const c = compararMuestras([CALCIO, vacia], []);

    expect(c.mallas).toEqual([6, 7, 10, 12, 20, 50, 100, 200]);
    expect(c.series).toHaveLength(2);
    expect(c.filas[0].r1).toBeNull();
  });

  it("sin producto repetido la etiqueta no lo lleva", () => {
    const otra = { ...CALCIO, id: "d", fecha: "2026-10-28" };
    const c = compararMuestras([CALCIO, otra], []);

    expect(c.series.map((s) => s.etiqueta)).toEqual(["27/10/2026", "28/10/2026"]);
  });

  it("cada serie se lleva un color distinto y sus propias claves", () => {
    const c = compararMuestras([CALCIO, FINO], []);

    expect(c.series[0].color).not.toBe(c.series[1].color);
    expect(c.series[0].claves).toEqual({ retenido: "r0", acumulado: "a0", pasante: "p0" });
    expect(c.series[1].claves).toEqual({ retenido: "r1", acumulado: "a1", pasante: "p1" });
  });

  it("el problema de una muestra viaja en su serie", () => {
    const pesada = { ...CALCIO, id: "e", pesoMuestraG: 50 };
    const c = compararMuestras([pesada, FINO], []);

    expect(c.series[0].problema).toBe("Lo retenido supera el peso de la muestra.");
    expect(c.series[1].problema).toBeUndefined();
  });

  it("sin muestras no hay eje ni series", () => {
    const c = compararMuestras([], []);

    expect(c.mallas).toEqual([]);
    expect(c.filas).toEqual([]);
    expect(c.series).toEqual([]);
    expect(c.disparejas).toEqual([]);
  });
});

describe("etiquetasDeMuestras", () => {
  it("numera los empates", () => {
    const base = { producto: "Cal", fecha: "2026-10-07", observaciones: null };

    expect(etiquetasDeMuestras([base, base], false)).toEqual([
      "07/10/2026 (1 de 2)",
      "07/10/2026 (2 de 2)",
    ]);
  });

  it("con el producto adelante los empates de fecha dejan de serlo", () => {
    const uno = { producto: "Cal", fecha: "2026-10-07", observaciones: null };
    const otro = { producto: "Filler 1", fecha: "2026-10-07", observaciones: null };

    expect(etiquetasDeMuestras([uno, otro], true)).toEqual([
      "Cal · 07/10/2026",
      "Filler 1 · 07/10/2026",
    ]);
  });

  it("corta la observacion larga", () => {
    const larga = {
      producto: "Cal",
      fecha: "2026-10-07",
      observaciones: "x".repeat(60),
    };

    expect(etiquetasDeMuestras([larga], false)).toEqual([`07/10/2026 · ${"x".repeat(40)}…`]);
  });
});

describe("TOPE_DE_MUESTRAS", () => {
  it("son seis", () => {
    expect(TOPE_DE_MUESTRAS).toBe(6);
  });
});
