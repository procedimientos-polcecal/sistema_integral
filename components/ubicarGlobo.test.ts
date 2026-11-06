import { describe, it, expect } from "vitest";
import { ubicarGlobo, ANCHO_GLOBO, MARGEN_GLOBO } from "./ubicarGlobo";

/** Un ícono de 16 px que arranca en `x`. */
const icono = (x: number, y = 100) => ({ left: x, right: x + 16, bottom: y });

const ESCRITORIO = 1280;
const TELEFONO = 375;

describe("donde va el globo del InfoTip", () => {
  it("se pega al icono por la izquierda cuando hay lugar", () => {
    const g = ubicarGlobo(icono(300), ESCRITORIO);
    expect(g.left).toBe(300);
    expect(g.ancho).toBe(ANCHO_GLOBO);
  });

  it("queda apenas debajo del icono", () => {
    expect(ubicarGlobo(icono(300, 142), ESCRITORIO).top).toBe(148);
  });

  /**
   * El caso que rompio: el (i) de la ultima columna de la tabla del MTBF. Con
   * el globo pegado por la izquierda el texto salia cortado al medio de una
   * palabra.
   */
  it("se alinea por la derecha del icono si por izquierda se saldria de la pantalla", () => {
    const g = ubicarGlobo(icono(1200), ESCRITORIO);
    // 1216 (el borde derecho del icono) menos los 260 del globo
    expect(g.left).toBe(956);
    expect(g.left + g.ancho).toBeLessThanOrEqual(ESCRITORIO - MARGEN_GLOBO);
  });

  it("nunca se sale por la derecha", () => {
    for (const x of [0, 300, 900, 1100, 1260, 1279]) {
      const g = ubicarGlobo(icono(x), ESCRITORIO);
      expect(g.left + g.ancho).toBeLessThanOrEqual(ESCRITORIO - MARGEN_GLOBO);
    }
  });

  it("nunca se sale por la izquierda", () => {
    for (const x of [-50, 0, 4, 300]) {
      expect(ubicarGlobo(icono(x), ESCRITORIO).left).toBeGreaterThanOrEqual(MARGEN_GLOBO);
    }
  });

  /**
   * En 375 px el globo de 260 entra entero, asi que no se achica: lo unico que
   * cambia es que se alinea por la derecha. El achique recien aparece en una
   * pantalla mas angosta que 276.
   */
  it("en un telefono el globo entra entero, alineado por la derecha del icono", () => {
    const g = ubicarGlobo(icono(340), TELEFONO);
    expect(g.ancho).toBe(ANCHO_GLOBO);
    expect(g.left).toBe(96); // 356, el borde derecho del icono, menos 260
    expect(g.left + g.ancho).toBeLessThanOrEqual(TELEFONO - MARGEN_GLOBO);
  });

  it("en una pantalla mas angosta que el globo, se achica y deja margen de los dos lados", () => {
    const g = ubicarGlobo(icono(200), 240);
    expect(g.ancho).toBe(240 - MARGEN_GLOBO * 2);
    expect(g.left).toBe(MARGEN_GLOBO);
    expect(g.left + g.ancho).toBe(240 - MARGEN_GLOBO);
  });

  /**
   * Un icono fuera de la pantalla —scrolleado dentro de una tabla ancha— no
   * puede empujar el globo afuera con el.
   */
  it("un icono que quedo fuera de la pantalla deja el globo adentro igual", () => {
    const g = ubicarGlobo(icono(2000), ESCRITORIO);
    expect(g.left).toBeGreaterThanOrEqual(MARGEN_GLOBO);
    expect(g.left + g.ancho).toBeLessThanOrEqual(ESCRITORIO - MARGEN_GLOBO);
  });
});
