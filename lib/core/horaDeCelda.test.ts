import { describe, expect, it } from "vitest";
import { horaDeCelda } from "./horaDeCelda";

describe("horaDeCelda", () => {
  it("convierte la fracción de día de las 04:40 (serial de Sheets)", () => {
    expect(horaDeCelda(4 / 24 + 40 / (24 * 60))).toBe("04:40");
  });

  it("acepta un texto ya formateado HH:MM", () => {
    expect(horaDeCelda("11:30")).toBe("11:30");
  });

  it("vacío o fuera de rango da null", () => {
    expect(horaDeCelda("")).toBeNull();
    expect(horaDeCelda(null)).toBeNull();
    expect(horaDeCelda(1.5)).toBeNull();
  });
});
