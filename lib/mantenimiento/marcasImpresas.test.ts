import { describe, it, expect } from "vitest";
import { letraDeEspecialidad, LEYENDA_IMPRESA } from "./marcasImpresas";

describe("letraDeEspecialidad", () => {
  it("MECÁNICO da 'M', ELÉCTRICO 'E', CIVIL 'C', LUBRICACIÓN 'L'", () => {
    expect(letraDeEspecialidad("MECÁNICO")).toBe("M");
    expect(letraDeEspecialidad("ELÉCTRICO")).toBe("E");
    expect(letraDeEspecialidad("CIVIL")).toBe("C");
    expect(letraDeEspecialidad("LUBRICACIÓN")).toBe("L");
  });

  it("'Lubricacion' sin tilde y en minúscula también da 'L'", () => {
    expect(letraDeEspecialidad("Lubricacion")).toBe("L");
    expect(letraDeEspecialidad("  mecanico ")).toBe("M");
  });

  it("null, undefined y cadena vacía dan '–'", () => {
    expect(letraDeEspecialidad(null)).toBe("–");
    expect(letraDeEspecialidad(undefined)).toBe("–");
    expect(letraDeEspecialidad("")).toBe("–");
    expect(letraDeEspecialidad("   ")).toBe("–");
  });

  it("INSTRUMENTACIÓN y OTRO dan '–', como el gris de la pantalla", () => {
    expect(letraDeEspecialidad("INSTRUMENTACIÓN")).toBe("–");
    expect(letraDeEspecialidad("OTRO")).toBe("–");
  });

  it("un valor que nadie conoce da '–' y no rompe", () => {
    expect(letraDeEspecialidad("PINTURA")).toBe("–");
    expect(letraDeEspecialidad("constructor")).toBe("–");
  });
});

describe("LEYENDA_IMPRESA", () => {
  it("tiene cinco entradas y ninguna letra repetida", () => {
    expect(LEYENDA_IMPRESA).toHaveLength(5);
    const letras = LEYENDA_IMPRESA.map((e) => e.letra);
    expect(new Set(letras).size).toBe(5);
  });

  it("cubre todas las letras que devuelve letraDeEspecialidad", () => {
    const letras = new Set(LEYENDA_IMPRESA.map((e) => e.letra));
    const todas = [
      "MECÁNICO", "ELÉCTRICO", "INSTRUMENTACIÓN", "CIVIL", "LUBRICACIÓN", "OTRO",
      null, "", "PINTURA",
    ];
    for (const e of todas) expect(letras.has(letraDeEspecialidad(e))).toBe(true);
  });
});
