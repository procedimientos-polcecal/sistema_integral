import { describe, it, expect } from "vitest";
import { numeroDeCampo } from "./numero";

/**
 * El bug de la coma decimal, 05/11/2026. En Cantera salía por las dos puntas
 * y en su forma silenciosa: el `n()` de los clientes y el `num()` de las rutas
 * hacían `Number(v)`, que con "2,5" da NaN, y el campo se guardaba vacío.
 */
describe("numeroDeCampo", () => {
  it("la coma decimal entra: un burden de 2,5 m es 2,5", () => {
    expect(numeroDeCampo("2,5")).toBeCloseTo(2.5);
    expect(numeroDeCampo("4,75")).toBeCloseTo(4.75);
    expect(numeroDeCampo("0,8")).toBeCloseTo(0.8);
  });

  /**
   * Medido el 05/11/2026: los 54 tipos de cambio cargados van de 1390 a 1560
   * —54 de 54 pasan los mil—, el monto por noche de sereno de 35.000 a 40.000,
   * y 3 de 16 cubicaciones pasan las mil toneladas (máximo 2240). Acá el punto
   * de miles es real y esperable, y por eso no se usa la lectura de
   * Calidad/Ensayos.
   */
  it("el punto de miles es de miles: un TC de 1.450 son mil cuatrocientos cincuenta", () => {
    expect(numeroDeCampo("1.450")).toBe(1450);
    expect(numeroDeCampo("40.000")).toBe(40000);
    expect(numeroDeCampo("2.240")).toBe(2240);
    expect(numeroDeCampo("1.234,5")).toBeCloseTo(1234.5);
  });

  /** Lo que ya viene interpretado pasa derecho: las rutas reciben las dos cosas. */
  it("un número pasa derecho y lo que no se entiende da null", () => {
    expect(numeroDeCampo(2.5)).toBeCloseTo(2.5);
    expect(numeroDeCampo("")).toBeNull();
    expect(numeroDeCampo("   ")).toBeNull();
    expect(numeroDeCampo(null)).toBeNull();
    expect(numeroDeCampo(undefined)).toBeNull();
    expect(numeroDeCampo("dos")).toBeNull();
  });
});
