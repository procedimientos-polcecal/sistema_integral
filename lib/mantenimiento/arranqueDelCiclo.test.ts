import { describe, it, expect } from "vitest";
import { loQueFaltaParaArrancar } from "./arranqueDelCiclo";

const HOY = "2026-11-12";

describe("loQueFaltaParaArrancar", () => {
  it("un arranque completo no tiene nada que faltar", () => {
    expect(loQueFaltaParaArrancar({ desde: "2026-11-07", vuelta_desde: 1 }, 3, HOY)).toEqual([]);
  });

  it("informa todos los problemas juntos", () => {
    expect(loQueFaltaParaArrancar({ desde: "", vuelta_desde: 9 }, 3, HOY))
      .toEqual(["la fecha del último trabajo", "en qué vuelta quedó"]);
  });

  /**
   * El caso de Filler 2, que el 12/11/2026 está en 4ª cara: lo próximo no es
   * una cuarta rotación sino el cambio. Un tope de `repeticiones - 1` dejaría
   * ese equipo sin poder arrancar.
   */
  it("una vuelta igual a las repeticiones es valida: lo proximo es la madre", () => {
    expect(loQueFaltaParaArrancar({ desde: "2026-11-11", vuelta_desde: 3 }, 3, HOY)).toEqual([]);
  });

  it("la vuelta cero es valida: los martillos estan recien cambiados", () => {
    expect(loQueFaltaParaArrancar({ desde: "2026-11-11", vuelta_desde: 0 }, 3, HOY)).toEqual([]);
  });

  it("una vuelta mayor a las repeticiones no", () => {
    expect(loQueFaltaParaArrancar({ desde: "2026-11-11", vuelta_desde: 4 }, 3, HOY))
      .toEqual(["en qué vuelta quedó"]);
  });

  it("una vuelta que no es un entero no", () => {
    for (const v of [1.5, "dos", null, undefined, true]) {
      expect(loQueFaltaParaArrancar({ desde: "2026-11-11", vuelta_desde: v }, 3, HOY))
        .toEqual(["en qué vuelta quedó"]);
    }
  });

  // Un trabajo que todavía no pasó no es el último trabajo hecho, y con una
  // fecha futura el ciclo generaría la orden siguiente más adelante todavía.
  it("una fecha futura no se acepta", () => {
    expect(loQueFaltaParaArrancar({ desde: "2027-01-01", vuelta_desde: 0 }, 3, HOY))
      .toContain("la fecha del último trabajo");
  });

  it("hoy si se acepta", () => {
    expect(loQueFaltaParaArrancar({ desde: HOY, vuelta_desde: 0 }, 3, HOY)).toEqual([]);
  });

  it("algo que no es una fecha tampoco", () => {
    for (const d of ["12/11/2026", "ayer", 20261112, null]) {
      expect(loQueFaltaParaArrancar({ desde: d, vuelta_desde: 0 }, 3, HOY))
        .toEqual(["la fecha del último trabajo"]);
    }
  });
});
