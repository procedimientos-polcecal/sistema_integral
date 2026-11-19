import { describe, expect, it } from "vitest";
import { loQueTraeUnRi, repartir } from "./loQueViene";

describe("loQueTraeUnRi", () => {
  it("resta lo que ya llegó: lo recibido está en el pañol, no en camino", () => {
    expect(loQueTraeUnRi({ nro_ri: 1, cantidad: 100, cantidad_recibida: 40, estado_compra: "PEDIDO", estado_aprobacion: null })).toBe(60);
  });
  it("un RI recibido entero no trae nada", () => {
    expect(loQueTraeUnRi({ nro_ri: 1, cantidad: 100, cantidad_recibida: 100, estado_compra: "RECIBIDO", estado_aprobacion: null })).toBe(0);
  });
  it("sin cantidad legible no trae nada, en vez de inventar", () => {
    expect(loQueTraeUnRi({ nro_ri: 1, cantidad: null, cantidad_recibida: null, estado_compra: "PEDIDO", estado_aprobacion: null })).toBe(0);
  });
  it("un RI denegado no trae nada", () => {
    expect(loQueTraeUnRi({ nro_ri: 1, cantidad: 50, cantidad_recibida: null, estado_compra: null, estado_aprobacion: "DENEGADA" })).toBe(0);
  });
});

describe("repartir", () => {
  const ri = { nro_ri: 2230, cantidad: 100, cantidad_recibida: null, estado_compra: "PEDIDO", estado_aprobacion: null };

  it("la más vieja primero, y la siguiente lee lo que queda", () => {
    const r = repartir([ri], [
      { orden_id: "b", ot_number: 2971, fecha: "2026-10-27", pide: 50 },
      { orden_id: "a", ot_number: 2970, fecha: "2026-10-26", pide: 80 },
    ]);
    expect(r).toEqual([
      { orden_id: "a", pide: 80, cubiertas: 80, faltaPedir: 0 },
      { orden_id: "b", pide: 50, cubiertas: 20, faltaPedir: 30 },
    ]);
  });

  it("con la misma fecha desempata el número de OT, que es el unico que no se reescribe solo", () => {
    const r = repartir([{ ...ri, cantidad: 10 }], [
      { orden_id: "z", ot_number: 2898, fecha: "2026-10-26", pide: 10 },
      { orden_id: "x", ot_number: 2896, fecha: "2026-10-26", pide: 10 },
    ]);
    expect(r[0].orden_id).toBe("x");
    expect(r[1].cubiertas).toBe(0);
  });

  it("una orden sin fecha va al final y no primera por accidente", () => {
    const r = repartir([{ ...ri, cantidad: 10 }], [
      { orden_id: "sin", ot_number: 1, fecha: null, pide: 10 },
      { orden_id: "con", ot_number: 9999, fecha: "2026-10-26", pide: 10 },
    ]);
    expect(r[0].orden_id).toBe("con");
  });

  it("suma lo que traen varios RI pegados", () => {
    const r = repartir([{ ...ri, cantidad: 60 }, { ...ri, nro_ri: 2231, cantidad: 60 }], [
      { orden_id: "a", ot_number: 1, fecha: "2026-10-26", pide: 100 },
    ]);
    expect(r[0].cubiertas).toBe(100);
  });

  it("sin cantidad legible la orden no dice cubiertas ni faltantes", () => {
    const r = repartir([ri], [{ orden_id: "a", ot_number: 1, fecha: "2026-10-26", pide: null }]);
    expect(r[0]).toEqual({ orden_id: "a", pide: null, cubiertas: 0, faltaPedir: 0 });
  });
});
