import { describe, it, expect } from "vitest";
import { numeroArgentino } from "./numeroArgentino";

/**
 * La regla del separador decimal, que Compras y RRHH resolvían por su cuenta y
 * los dos igual de mal. Los casos de acá son el contrato: si se cambia alguno,
 * se cambia para los dos módulos a la vez, que es el punto de tenerla en uno.
 */
describe("numeroArgentino", () => {
  it("con los dos separadores, el último es el decimal", () => {
    expect(numeroArgentino("1.500,50")).toBeCloseTo(1500.5);
    expect(numeroArgentino("1,500.50")).toBeCloseTo(1500.5);
    expect(numeroArgentino("1.234.567,89")).toBeCloseTo(1234567.89);
  });

  /**
   * El caso que costaba plata. "3.500" es como se escribe tres mil quinientos,
   * y entraba como 3,5 — en RRHH, un valor hora de tres pesos con cincuenta.
   */
  it("un separador solo, con tres dígitos detrás, es de miles", () => {
    expect(numeroArgentino("3.500")).toBe(3500);
    expect(numeroArgentino("1.234.567")).toBe(1234567);
    expect(numeroArgentino("-3.500")).toBe(-3500);
    // Y lo mismo del otro lado, para un archivo escrito a la inglesa.
    expect(numeroArgentino("3,500")).toBe(3500);
    expect(numeroArgentino("1,234,567")).toBe(1234567);
  });

  it("cualquier otro separador solo es el decimal", () => {
    expect(numeroArgentino("3500,5")).toBeCloseTo(3500.5);
    expect(numeroArgentino("3500.5")).toBeCloseTo(3500.5);
    expect(numeroArgentino("3.5")).toBeCloseTo(3.5);
    expect(numeroArgentino("3.50")).toBeCloseTo(3.5);
    // Cuatro dígitos delante: unos miles bien escritos serían "3.500.500".
    expect(numeroArgentino("3500.500")).toBeCloseTo(3500.5);
  });

  /**
   * Sin esto el IVA se rompe: se guarda como fracción, y "0.210" tiene tres
   * dígitos detrás del punto — pasaría por miles y daría 210 en vez de 0,21.
   */
  it("un cero adelante desarma la regla de los miles", () => {
    expect(numeroArgentino("0.500")).toBeCloseTo(0.5);
    expect(numeroArgentino("0.210")).toBeCloseTo(0.21);
    expect(numeroArgentino("-0.500")).toBeCloseTo(-0.5);
  });

  it("sin separadores no hay nada que decidir", () => {
    expect(numeroArgentino("3500")).toBe(3500);
    expect(numeroArgentino("-3500")).toBe(-3500);
    expect(numeroArgentino("0")).toBe(0);
  });

  it("lo que no es un número no inventa uno", () => {
    expect(numeroArgentino("")).toBeNull();
    expect(numeroArgentino("-")).toBeNull();
    expect(numeroArgentino(".")).toBeNull();
    expect(numeroArgentino("1-3")).toBeNull();
  });
});
