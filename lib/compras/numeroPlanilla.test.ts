import { describe, it, expect } from "vitest";
import { numeroDeLaPlanilla } from "./sheets";

/**
 * Los casos son los que se midieron contra la planilla real el 14/09/2026,
 * no inventados: la sincronización tenía una copia privada de la regla vieja
 * —"si no hay coma, el punto es decimal"— y con ella 62 cantidades entraban
 * mil veces más chicas. El valor equivocado ya estaba guardado en la base.
 *
 * La regla de verdad vive en `lib/core/numeroArgentino.ts`. Esto comprueba que
 * la planilla de Compras la use, que es exactamente lo que faltaba.
 */
describe("los números que escribe la planilla de Compras", () => {
  it("un entero con separador de miles no es un decimal", () => {
    // La celda del RI 57 dice "30.000" y el sistema tenía 30.
    expect(numeroDeLaPlanilla("30.000")).toBe(30000);
    expect(numeroDeLaPlanilla("1.500")).toBe(1500);
    expect(numeroDeLaPlanilla("1.000")).toBe(1000);
    expect(numeroDeLaPlanilla("2.070")).toBe(2070);
  });

  it("un decimal de verdad sigue siendo decimal", () => {
    expect(numeroDeLaPlanilla("12,5")).toBe(12.5);
    expect(numeroDeLaPlanilla("0,5")).toBe(0.5);
    // Con dos decimales no hay ambigüedad posible.
    expect(numeroDeLaPlanilla("3500.55")).toBe(3500.55);
  });

  it("un cero adelante no son miles: el IVA se guarda como fracción", () => {
    expect(numeroDeLaPlanilla("0.210")).toBeCloseTo(0.21, 5);
  });

  it("los importes con los dos separadores no cambiaron", () => {
    // Es la rama que ya andaba, y la que decide plata.
    expect(numeroDeLaPlanilla("$64.343,57")).toBeCloseTo(64343.57, 2);
    expect(numeroDeLaPlanilla("$1.234.567,89")).toBeCloseTo(1234567.89, 2);
    expect(numeroDeLaPlanilla("1,234,567.89")).toBeCloseTo(1234567.89, 2);
  });

  it("un número ya numérico pasa tal cual, sin pasar por el texto", () => {
    expect(numeroDeLaPlanilla(30000)).toBe(30000);
    expect(numeroDeLaPlanilla(5.5)).toBe(5.5);
  });

  it("la celda vacía es null, no cero", () => {
    // Cero es una decisión; vacío es que no se cargó. La orden de compra los
    // trata distinto.
    expect(numeroDeLaPlanilla("")).toBeNull();
    expect(numeroDeLaPlanilla(null)).toBeNull();
    expect(numeroDeLaPlanilla(undefined)).toBeNull();
    expect(numeroDeLaPlanilla("   ")).toBeNull();
    expect(numeroDeLaPlanilla("s/d")).toBeNull();
  });

  it("un negativo sobrevive a la limpieza de símbolos", () => {
    expect(numeroDeLaPlanilla("-1.500")).toBe(-1500);
  });
});
