import { describe, it, expect } from "vitest";
import {
  montoPerforacion,
  montoBochon,
  montoVoladura,
  baseDeConsumosUsd,
  cruce,
} from "./costos";

describe("montoPerforacion", () => {
  it("reproduce el total de V01D625 de la planilla", () => {
    // 36 pozos × 3 m = 108 m perforados × 13,43 USD/m × 1515 $/USD
    expect(montoPerforacion({ metros: 108, precioUsdM: 13.43, tc: 1515 })).toBeCloseTo(2197416.6, 0);
  });

  it("suma las noches de sereno en pesos, sin pasar por el TC", () => {
    // 108 × 13,43 × 1515 = 2.197.417  +  4 noches × $30.000 = 120.000
    expect(
      montoPerforacion({ metros: 108, precioUsdM: 13.43, tc: 1515, nochesSereno: 4, montoNoche: 30000 })
    ).toBeCloseTo(2197416.6 + 120000, 0);
  });

  it("es null si falta un dato de carga", () => {
    expect(montoPerforacion({ metros: null, precioUsdM: 13.43, tc: 1515 })).toBeNull();
    expect(montoPerforacion({ metros: 108, precioUsdM: null, tc: 1515 })).toBeNull();
  });
});

describe("montoBochon", () => {
  it("es cantidad × metros × precio USD/m × TC (B01D625: 197 bochones × 1 m × 5,07 × 1515)", () => {
    expect(montoBochon({ cantidad: 197, metrosPerforados: 1, precioUsdM: 5.07, tc: 1515 })).toBeCloseTo(1513166.85, 0);
  });

  it("es null si falta la cantidad de bochones", () => {
    expect(montoBochon({ cantidad: null, metrosPerforados: 1, precioUsdM: 5.07, tc: 1515 })).toBeNull();
  });
});

describe("montoVoladura", () => {
  it("suma los insumos, agrega el 4% de servicio y lo pasa a pesos", () => {
    const consumos = [
      { cantidad: 48.5, precio_usd: 4.24 },
      { cantidad: 30, precio_usd: 5.34 },
    ];
    // base = 205,64 + 160,2 = 365,84 USD → ×1,04 servicio → ×1515
    expect(montoVoladura(consumos, 1515)).toBeCloseTo(365.84 * 1.04 * 1515, 0);
  });

  it("no vuelve a sumar una fila de servicio ya cargada: la recalcula", () => {
    const consumos = [
      { cantidad: 100, precio_usd: 2, tipo: "detonador" },
      { cantidad: 1, precio_usd: 0.04, tipo: "voladura" }, // se ignora
    ];
    // base 200 → ×1,04 → 208 × 1000
    expect(montoVoladura(consumos, 1000)).toBe(208000);
  });

  it("ignora renglones incompletos y es null sin TC o sin renglones", () => {
    expect(montoVoladura([{ cantidad: null, precio_usd: 5 }], 1000)).toBe(0);
    expect(montoVoladura([], 1515)).toBeNull();
    expect(montoVoladura([{ cantidad: 1, precio_usd: 1 }], null)).toBeNull();
  });
});

describe("baseDeConsumosUsd", () => {
  it("suma los insumos reales y excluye el servicio", () => {
    expect(
      baseDeConsumosUsd([
        { cantidad: 10, precio_usd: 4, tipo: "detonador" },
        { cantidad: 1, precio_usd: 99, tipo: "voladura" },
      ])
    ).toBe(40);
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
