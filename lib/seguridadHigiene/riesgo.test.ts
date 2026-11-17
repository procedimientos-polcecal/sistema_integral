import { describe, expect, it } from "vitest";
import { clasificar, CRITERIOS } from "./riesgo";

describe("clasificar", () => {
  it("clasifica cada borde exacto", () => {
    expect(clasificar(139)).toBe("I");
    expect(clasificar(138)).toBe("S");
    expect(clasificar(90)).toBe("S");
    expect(clasificar(89)).toBe("M");
    expect(clasificar(49)).toBe("M");
    expect(clasificar(48)).toBe("PS");
    expect(clasificar(18)).toBe("PS");
    expect(clasificar(17)).toBe("NS");
    expect(clasificar(1)).toBe("NS");
  });

  it("sin nivel no hay clasificación", () => {
    expect(clasificar(null)).toBeNull();
    expect(clasificar(0)).toBeNull();
  });

  // El Excel del que viene esto decía IF(151>=49,"M",…) en todas las filas menos
  // una: una constante donde iba el nivel. Nada podía salir PS ni NS, y nadie lo
  // notó en 44 filas. Este test es ese error.
  it("un nivel bajo NO cae siempre en M", () => {
    expect(clasificar(42)).toBe("PS");
    expect(clasificar(9)).toBe("NS");
  });
});

describe("CRITERIOS", () => {
  it("los cinco criterios tienen los puntajes de la planilla", () => {
    expect(CRITERIOS.frecuencia.map((o) => o.puntos)).toEqual([3, 2, 1]);
    expect(CRITERIOS.antecedentes.map((o) => o.puntos)).toEqual([3, 2, 1]);
    expect(CRITERIOS.controles.map((o) => o.puntos)).toEqual([5, 3, 1]);
    expect(CRITERIOS.magnitud_dano.map((o) => o.puntos)).toEqual([9, 7, 3]);
    expect(CRITERIOS.legislacion.map((o) => o.puntos)).toEqual([5, 3, 1]);
  });

  it("cada opción trae el texto que explica cuándo corresponde", () => {
    for (const opciones of Object.values(CRITERIOS)) {
      for (const o of opciones) expect(o.texto.length).toBeGreaterThan(10);
    }
  });
});
