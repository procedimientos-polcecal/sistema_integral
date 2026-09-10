import { describe, it, expect } from "vitest";
import { totalesDeConsumos, faltaDesglose } from "./consumos";

describe("totalesDeConsumos", () => {
  it("suma los insumos, calcula el servicio como 4% de la base y desglosa por tipo", () => {
    const consumos = [
      { tipo: "detonador", cantidad: 48.5, precio_usd: 4.24 },
      { tipo: "otros_insumos", cantidad: 30, precio_usd: 5.34 },
      { tipo: "voladura", cantidad: 1, precio_usd: 999 }, // se ignora: se recalcula
    ];
    const base = 205.64 + 160.2;
    const r = totalesDeConsumos(consumos, 1515);
    expect(r.porTipo.detonador.usd).toBeCloseTo(205.64, 2);
    expect(r.porTipo.voladura.usd).toBeCloseTo(base * 0.04, 2);
    expect(r.totalUsd).toBeCloseTo(base * 1.04, 2);
    expect(r.totalArs).toBeCloseTo(base * 1.04 * 1515, 0);
  });

  it("ignora renglones incompletos sin romper", () => {
    const r = totalesDeConsumos([{ tipo: "detonador", cantidad: null, precio_usd: 4 }], 1000);
    expect(r.totalUsd).toBe(0);
  });

  it("un tipo nulo cae en otros_insumos", () => {
    const r = totalesDeConsumos([{ tipo: null, cantidad: 2, precio_usd: 3 }], 1000);
    expect(r.porTipo.otros_insumos.usd).toBe(6);
  });
});

describe("faltaDesglose", () => {
  it("avisa cuando hay texto de explosivos pero ningún renglón", () => {
    expect(faltaDesglose("emulex x 60 mm: 48,5", [])).toBe(true);
  });

  it("no avisa si hay renglones, o si no hay texto", () => {
    expect(faltaDesglose("emulex x 60 mm: 48,5", [{}])).toBe(false);
    expect(faltaDesglose("", [])).toBe(false);
    expect(faltaDesglose(null, [])).toBe(false);
  });
});
