import { describe, it, expect } from "vitest";
import { ordenarRequerimientos } from "./constants";
import type { Prioridad } from "./types";

const ri = (nro: number, prioridad: Prioridad | null, fecha: string, updated: string) =>
  ({ nro_ri: nro, prioridad, fecha, updated_at: updated });

/**
 * Cada columna del tablero se ordena por su cuenta: en "Para comprar" interesa
 * la urgencia, y en "Pedido" lo que se movio recien.
 */
describe("orden de una columna del tablero", () => {
  const items = [
    ri(100, "NORMAL", "2026-01-01", "2026-08-01"),
    ri(300, "URGENTE", "2026-05-01", "2026-08-20"),
    ri(200, null, "2026-03-01", "2026-08-24"),
  ];

  it("por prioridad: primero lo urgente, y a igual urgencia lo mas viejo", () => {
    const r = ordenarRequerimientos(items, "prioridad");
    expect(r.map((x) => x.nro_ri)).toEqual([300, 100, 200]);
  });

  it("por numero: el mas nuevo primero", () => {
    const r = ordenarRequerimientos(items, "numero");
    expect(r.map((x) => x.nro_ri)).toEqual([300, 200, 100]);
  });

  it("por cambio reciente: lo ultimo que se movio", () => {
    const r = ordenarRequerimientos(items, "cambio");
    expect(r.map((x) => x.nro_ri)).toEqual([200, 300, 100]);
  });

  it("no altera el arreglo que recibe", () => {
    const copia = [...items];
    ordenarRequerimientos(items, "numero");
    expect(items).toEqual(copia);
  });
});
