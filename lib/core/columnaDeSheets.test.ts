import { describe, it, expect } from "vitest";
import { letraDeColumna, indiceDeColumna } from "./columnaDeSheets";

/**
 * Habia tres implementaciones de esto y dos estaban rotas pasada la Z. Los
 * casos de aca son el contrato de la unica que quedo.
 */
describe("letraDeColumna", () => {
  it("las de una letra", () => {
    expect(letraDeColumna(0)).toBe("A");
    expect(letraDeColumna(18)).toBe("S");   // la ultima de la comparativa
    expect(letraDeColumna(22)).toBe("W");   // la ultima de la planilla de OT
    expect(letraDeColumna(25)).toBe("Z");
  });

  /**
   * Justo donde fallaba la version vieja: `String.fromCharCode(65 + 26)` es
   * "[", y un rango con corchete Google lo rechaza sin decir por que.
   */
  it("las de dos letras, que es donde se rompia", () => {
    expect(letraDeColumna(26)).toBe("AA");
    expect(letraDeColumna(27)).toBe("AB");
    expect(letraDeColumna(51)).toBe("AZ");
    expect(letraDeColumna(52)).toBe("BA");
    expect(letraDeColumna(701)).toBe("ZZ");
  });

  it("las de tres letras", () => {
    expect(letraDeColumna(702)).toBe("AAA");
  });

  /**
   * El -1 es "esta columna no esta en el encabezado". La version vieja lo
   * convertia en "@" y la formula del total salia "...+@1001", para que Excel
   * la marcara como error mucho despues. Ahora se ve en el momento.
   */
  it("un indice que no es una columna revienta en vez de inventar un simbolo", () => {
    expect(() => letraDeColumna(-1)).toThrow(/no es un índice de columna/);
    expect(() => letraDeColumna(1.5)).toThrow();
  });
});

describe("indiceDeColumna", () => {
  it("es la vuelta exacta de letraDeColumna", () => {
    for (const i of [0, 15, 25, 26, 27, 51, 52, 701, 702]) {
      expect(indiceDeColumna(letraDeColumna(i))).toBe(i);
    }
  });

  /** La que importa: `P` es la columna Estado de las hojas por área. */
  it("P es la 15", () => {
    expect(indiceDeColumna("P")).toBe(15);
  });

  it("no se pelea con minúsculas ni espacios", () => {
    expect(indiceDeColumna(" p ")).toBe(15);
  });

  /**
   * Devuelve -1 y no un número inventado: el llamador ya sabe leer ese -1 como
   * "esta columna no existe" y frena ahí. Un 0 silencioso apuntaría a la A.
   */
  it("lo que no es una columna da -1", () => {
    expect(indiceDeColumna("")).toBe(-1);
    expect(indiceDeColumna("P9")).toBe(-1);
    expect(indiceDeColumna("Ñ")).toBe(-1);
  });
});
