import { describe, it, expect } from "vitest";
import { diasCorridos, fechaCorta, porcentajeDeConfiabilidad } from "./mtbfVista";

describe("el porcentaje de confiabilidad", () => {
  it("no inventa un numero cuando no hay MTBF", () => {
    expect(porcentajeDeConfiabilidad(null)).toBe("—");
  });

  it("redondea a entero desde el 1%", () => {
    expect(porcentajeDeConfiabilidad(0.7231)).toBe("72%");
    expect(porcentajeDeConfiabilidad(0.0149)).toBe("1%");
  });

  it("usa un decimal, con coma, por debajo del 1%", () => {
    expect(porcentajeDeConfiabilidad(0.0012)).toBe("0,1%");
    expect(porcentajeDeConfiabilidad(0.0075)).toBe("0,8%");
  });

  it("no muestra 0% cuando es chico pero no es cero", () => {
    expect(porcentajeDeConfiabilidad(0.00001)).toBe("<0,1%");
  });
});

describe("los dias corridos", () => {
  it("lleva un decimal con coma", () => {
    expect(diasCorridos(4.6)).toBe("4,6 d");
  });

  it("no inventa un numero cuando no hay MTBF", () => {
    expect(diasCorridos(null)).toBe("—");
  });
});

describe("la fecha corta", () => {
  it("da vuelta un YYYY-MM-DD sin pasar por Date", () => {
    expect(fechaCorta("2026-10-01")).toBe("01/10/2026");
  });
});
