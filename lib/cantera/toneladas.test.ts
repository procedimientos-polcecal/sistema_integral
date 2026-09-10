import { describe, it, expect } from "vitest";
import { toneladasEstimadas, desvioContraPlanilla } from "./toneladas";

describe("toneladasEstimadas", () => {
  it("aplica la fórmula de cantera con los datos de V01D625", () => {
    // 36 pozos × 3 m × 2,65 (Dolomita) × 2,8 burden × 2,5 espaciamiento
    expect(
      toneladasEstimadas({
        pozos: 36,
        metrosPorPozo: 3,
        densidad: 2.65,
        burden: 2.8,
        espaciamiento: 2.5,
      })
    ).toBeCloseTo(2003.4, 1);
  });

  it("devuelve null si falta cualquiera de los cinco datos", () => {
    const base = { pozos: 10, metrosPorPozo: 5, densidad: 2.7, burden: 2.8, espaciamiento: 2.5 };
    expect(toneladasEstimadas({ ...base, pozos: null })).toBeNull();
    expect(toneladasEstimadas({ ...base, espaciamiento: undefined })).toBeNull();
  });
});

describe("desvioContraPlanilla", () => {
  it("marca fuera de rango cuando la estimada supera el 15% de la histórica", () => {
    // V01D625: estimada 2003,4 vs planilla 1686,96 → +18,8%
    const d = desvioContraPlanilla(2003.4, 1686.96);
    expect(d.porcentaje).toBeGreaterThan(0.15);
    expect(d.fueraDeRango).toBe(true);
  });

  it("no marca nada si la diferencia es chica", () => {
    const d = desvioContraPlanilla(1700, 1686.96);
    expect(d.fueraDeRango).toBe(false);
  });

  it("no compara si falta la estimada o la histórica", () => {
    expect(desvioContraPlanilla(null, 1000).porcentaje).toBeNull();
    expect(desvioContraPlanilla(1000, null).porcentaje).toBeNull();
    expect(desvioContraPlanilla(1000, 0).porcentaje).toBeNull();
  });
});
