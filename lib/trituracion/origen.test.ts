import { describe, expect, it } from "vitest";
import { yacimientoDelOrigen } from "./origen";

describe("yacimientoDelOrigen", () => {
  it("resuelve un código de yacimiento exacto", () => {
    expect(yacimientoDelOrigen("D1")).toBe("D1");
    expect(yacimientoDelOrigen("c3")).toBe("C3");
  });

  it("no resuelve un proveedor externo ni un acopio", () => {
    expect(yacimientoDelOrigen("LOMA NEGRA")).toBeNull();
    expect(yacimientoDelOrigen("PEZZUCCHI")).toBeNull();
    expect(yacimientoDelOrigen("ACOPIO")).toBeNull();
  });

  it("no resuelve otra planta como si fuera un yacimiento", () => {
    expect(yacimientoDelOrigen("PLANTA 2")).toBeNull();
  });

  it("null u origen vacío da null", () => {
    expect(yacimientoDelOrigen(null)).toBeNull();
    expect(yacimientoDelOrigen("")).toBeNull();
  });
});
