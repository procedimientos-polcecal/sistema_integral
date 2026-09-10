import { describe, it, expect } from "vitest";
import {
  metrosPerforados,
  montoPerforacion,
  montoBochon,
  montoVoladura,
  cruce,
} from "./costos";

describe("montoPerforacion", () => {
  it("reproduce el total de V01D625 de la planilla", () => {
    // 36 pozos × 3 m = 108 m perforados × 13,43 USD/m × 1515 $/USD
    expect(
      montoPerforacion({ pozos: 36, metrosPorPozo: 3, precioUsdM: 13.43, tc: 1515 })
    ).toBeCloseTo(2197416.6, 0);
  });

  it("es null si falta un dato de carga", () => {
    expect(montoPerforacion({ pozos: 36, metrosPorPozo: null, precioUsdM: 13.43, tc: 1515 })).toBeNull();
    expect(montoPerforacion({ pozos: 36, metrosPorPozo: 3, precioUsdM: null, tc: 1515 })).toBeNull();
  });
});

describe("metrosPerforados", () => {
  it("es pozos × metros por pozo", () => {
    expect(metrosPerforados(36, 3)).toBe(108);
  });
  it("es null si falta alguno", () => {
    expect(metrosPerforados(null, 3)).toBeNull();
  });
});

describe("montoBochon", () => {
  it("es metros × precio USD/m × TC (B01D625: 197 × 5,07 × 1515)", () => {
    expect(montoBochon({ metrosPerforados: 197, precioUsdM: 5.07, tc: 1515 })).toBeCloseTo(1513166.85, 0);
  });
});

describe("montoVoladura", () => {
  it("suma los renglones de consumo y lo pasa a pesos", () => {
    const consumos = [
      { cantidad: 48.5, precio_usd: 4.24 },
      { cantidad: 30, precio_usd: 5.34 },
    ];
    // (48,5×4,24 + 30×5,34) = 205,64 + 160,2 = 365,84 USD × 1515
    expect(montoVoladura(consumos, 1515)).toBeCloseTo(554247.6, 0);
  });

  it("ignora los renglones con cantidad o precio faltante, no rompe", () => {
    const consumos = [
      { cantidad: 100, precio_usd: 2 },
      { cantidad: null, precio_usd: 5 },
    ];
    expect(montoVoladura(consumos, 1000)).toBe(200000);
  });

  it("es null sin renglones o sin TC (0 diría que no costó nada)", () => {
    expect(montoVoladura([], 1515)).toBeNull();
    expect(montoVoladura([{ cantidad: 1, precio_usd: 1 }], null)).toBeNull();
  });
});

describe("cruce", () => {
  it("coincide cuando la diferencia entra en el 2%", () => {
    const r = cruce(2_197_417, 2_197_400);
    expect(r.lectura).toBe("coincide");
  });

  it("revisar cuando se pasa del 2%", () => {
    const r = cruce(2_197_417, 1_800_000);
    expect(r.lectura).toBe("revisar");
    expect(r.diferencia).toBeCloseTo(397417, 0);
  });

  it("sin_monto cuando el SdG no pudo calcular", () => {
    expect(cruce(null, 1_000_000).lectura).toBe("sin_monto");
  });

  it("sin_factura cuando finanzas todavía no vinculó ninguna", () => {
    expect(cruce(1_000_000, null).lectura).toBe("sin_factura");
  });
});
