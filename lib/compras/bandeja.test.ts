import { describe, it, expect } from "vitest";
import { puedeQuitarDeLaLista, repartirBandeja } from "./bandeja";

/**
 * Sin nadie en la lista no se aprueba nada y el circuito se traba entero: ni
 * los requerimientos pasan a comparativa ni las compras se aprueban. Sacar al
 * ultimo se rechaza con un motivo, no con un error generico.
 */
describe("quitar a alguien de la lista de aprobadores", () => {
  it("con dos o mas, se puede", () => {
    expect(puedeQuitarDeLaLista(2)).toEqual({ ok: true });
  });

  it("al ultimo no", () => {
    const r = puedeQuitarDeLaLista(1);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain("sin nadie");
  });

  it("una lista ya vacia tampoco deja quitar", () => {
    expect(puedeQuitarDeLaLista(0).ok).toBe(false);
  });
});

const ri = (nro: number, asignadoA: string | null, prioridad: "URGENTE" | "NORMAL" | null) => ({
  nro_ri: nro,
  compra_asignada_a: asignadoA,
  prioridad,
  fecha: `2026-0${nro}-01T00:00:00Z`,
  updated_at: `2026-0${nro}-01T00:00:00Z`,
});

describe("reparto de la bandeja", () => {
  const yo = "usuario-nico";
  const otro = "usuario-maxi";
  const items = [
    ri(1, otro, "URGENTE"),
    ri(2, yo, "NORMAL"),
    ri(3, yo, "URGENTE"),
    ri(4, null, null),
  ];

  it("lo asignado a quien mira va arriba", () => {
    const { mios } = repartirBandeja(items, yo);
    expect(mios.map((x) => x.nro_ri).sort()).toEqual([2, 3]);
  });

  it("el resto va abajo, incluido lo que no tiene asignado", () => {
    const { deOtros } = repartirBandeja(items, yo);
    expect(deOtros.map((x) => x.nro_ri).sort()).toEqual([1, 4]);
  });

  it("cada bloque va por urgencia y despues por antiguedad", () => {
    const { mios } = repartirBandeja(items, yo);
    expect(mios.map((x) => x.nro_ri)).toEqual([3, 2]);
  });

  it("nadie queda en los dos bloques", () => {
    const { mios, deOtros } = repartirBandeja(items, yo);
    expect(mios.length + deOtros.length).toBe(items.length);
  });
});
