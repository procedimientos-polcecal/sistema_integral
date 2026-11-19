import { describe, expect, it } from "vitest";
import {
  COLORES_DE_LA_COMPARACION,
  TOPE_DE_MUESTRAS,
  TRAZOS_DE_LA_COMPARACION,
  compararMuestras,
  etiquetasDeMuestras,
} from "./comparacion";

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

  it("un cero medido se guarda como cero y no como hueco", () => {
    const c = compararMuestras([CALCIO, FINO], []);

    // La #6 de Calcio midio 0 g: es una medicion, no una malla que falte. Es la
    // distincion que sostiene toda la funcion, y la rompe cualquiera que cambie
    // el `?? null` por un `|| null`.
    const enSeis = c.filas.find((f) => f.malla === 6)!;
    expect(enSeis.r0).toBe(0);
    expect(enSeis.a0).toBe(0);
    expect(enSeis.p0).toBe(100);
    expect(enSeis.r1).toBeNull();
  });

  it("dice cuales de las elegidas no tienen granulometria, y esas no son disparejas", () => {
    const vacia = { ...FINO, id: "c", retenidos: [] };
    const c = compararMuestras([CALCIO, vacia], []);

    expect(c.sinGranulometria).toEqual(["Filler 1 · 03/11/2026"]);
    // Sin esto diria «no midio #6, #7, #10, #12, #20, #50, #100 ni #200», que es
    // cierto y una forma rarisima de decir «no tiene granulometria cargada».
    expect(c.disparejas).toEqual([]);
  });

  it("una muestra sin peso no es «sin granulometria»: tiene su propio problema", () => {
    const c = compararMuestras([{ ...CALCIO, id: "f", pesoMuestraG: null }], []);

    expect(c.sinGranulometria).toEqual([]);
    expect(c.series[0].problema).toBe("Falta el peso de la muestra tamizada.");
  });

  it("cada serie se lleva un color distinto y sus propias claves", () => {
    const c = compararMuestras([CALCIO, FINO], []);

    expect(c.series[0].color).not.toBe(c.series[1].color);
    expect(c.series[0].claves).toEqual({ retenido: "r0", acumulado: "a0", pasante: "p0" });
    expect(c.series[1].claves).toEqual({ retenido: "r1", acumulado: "a1", pasante: "p1" });
    expect(c.series[0].trazo).not.toBe(c.series[1].trazo);
  });

  it("la primera serie es el verde de siempre y va de linea llena", () => {
    const c = compararMuestras([CALCIO], []);

    // Una sola muestra tiene que verse como antes de que esto existiera.
    expect(c.series[0].color).toBe("#1E7D34");
    expect(c.series[0].trazo).toBeUndefined();
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

/** La luminancia relativa de WCAG, que es lo que queda de un color fotocopiado. */
function luminancia(hex: string): number {
  const canal = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

const contraste = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * El Excel se pega en un informe que se imprime y se fotocopia, así que el
 * criterio de la paleta no es cómo se ve en pantalla.
 *
 * La primera versión tenía verde y naranja con contraste **1,004**: el mismo
 * gris exacto. Estos tests fijan las dos propiedades que lo arreglan, y la
 * segunda es la que de verdad separa las curvas — ver el comentario de
 * `COLORES_DE_LA_COMPARACION`.
 */
describe("la paleta sobrevive al blanco y negro", () => {
  it("todos los colores se ven contra el fondo blanco", () => {
    for (const color of COLORES_DE_LA_COMPARACION) {
      expect(contraste(luminancia(color), 1)).toBeGreaterThanOrEqual(2.5);
    }
  });

  it("ningun par de colores cae en el mismo gris", () => {
    for (let i = 0; i < COLORES_DE_LA_COMPARACION.length; i++) {
      for (let j = i + 1; j < COLORES_DE_LA_COMPARACION.length; j++) {
        const r = contraste(
          luminancia(COLORES_DE_LA_COMPARACION[i]),
          luminancia(COLORES_DE_LA_COMPARACION[j])
        );
        expect(r).toBeGreaterThan(1.15);
      }
    }
  });

  it("cada serie lleva un trazo distinto, que es lo que separa de verdad en gris", () => {
    // La banda de luminancia que deja un fondo blanco llega hasta 0,37, así que
    // seis colores ahí adentro no pasan de un contraste de ~1,2 entre sí. El
    // trazo no depende del tóner.
    expect(TRAZOS_DE_LA_COMPARACION).toHaveLength(COLORES_DE_LA_COMPARACION.length);
    expect(new Set(TRAZOS_DE_LA_COMPARACION).size).toBe(TRAZOS_DE_LA_COMPARACION.length);
  });
});

describe("TOPE_DE_MUESTRAS", () => {
  it("son seis, y hay un color y un trazo para cada una", () => {
    expect(TOPE_DE_MUESTRAS).toBe(6);
    expect(COLORES_DE_LA_COMPARACION).toHaveLength(TOPE_DE_MUESTRAS);
  });
});
