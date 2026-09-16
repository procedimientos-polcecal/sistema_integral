import { describe, it, expect } from "vitest";
import { desvioDelConteo } from "./conteos";

describe("desvioDelConteo", () => {
  it("cuando coincide no propone ningún ajuste", () => {
    expect(desvioDelConteo(300, 300)).toEqual({ desvio: 0, hayDesvio: false, ajuste: null });
  });

  it("cuando falta carbón propone un ajuste en menos", () => {
    // El 11/09/2026: teórico 326,857, contado 298.
    const r = desvioDelConteo(298, 326.857);
    expect(r.hayDesvio).toBe(true);
    expect(r.desvio).toBe(-28.857);
    expect(r.ajuste).toEqual({ toneladas: -28.857 });
  });

  it("cuando sobra carbón propone un ajuste en más", () => {
    // El 27/08/2026: desvío +16,063.
    const r = desvioDelConteo(190, 173.937);
    expect(r.desvio).toBe(16.063);
    expect(r.ajuste).toEqual({ toneladas: 16.063 });
  });

  it("el ajuste lleva al saldo exactamente a lo contado", () => {
    const r = desvioDelConteo(298, 326.857);
    expect(326.857 + r.ajuste!.toneladas).toBeCloseTo(298, 3);
  });

  it("un conteo que no es número se rechaza", () => {
    expect(desvioDelConteo(NaN, 300).problema).toBeTruthy();
    expect(desvioDelConteo(300, NaN).problema).toBeTruthy();
  });

  it("un conteo negativo se rechaza: no hay stock físico negativo", () => {
    expect(desvioDelConteo(-5, 300).problema).toBeTruthy();
  });
});
