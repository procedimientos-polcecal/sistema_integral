import { describe, it, expect } from "vitest";
import { indicadoresDeOrdenes } from "./indicadores";
import type { HorariosDeOrden } from "./types";

function orden(
  numero: string,
  entrada: string,
  inicio: string | null,
  fin: string | null,
  salida: string | null
): HorariosDeOrden & { numero: string; cliente_raw: string | null } {
  const dia = (hhmm: string) => `2026-09-08T${hhmm}:00.000Z`;
  return {
    numero,
    cliente_raw: `cliente ${numero}`,
    entrada_predio: dia(entrada),
    inicio_carga: inicio ? dia(inicio) : null,
    fin_carga: fin ? dia(fin) : null,
    salida_predio: salida ? dia(salida) : null,
  };
}

describe("indicadoresDeOrdenes", () => {
  it("promedia los tiempos y cuenta las órdenes", () => {
    const r = indicadoresDeOrdenes([
      orden("1", "13:00", "13:20", "14:00", "14:15"), // carga 40, predio 75
      orden("2", "15:00", "15:10", "15:30", "15:40"), // carga 20, predio 40
    ]);

    expect(r.cantidad).toBe(2);
    expect(r.promedioCarga).toBe(30);
    expect(r.promedioPredio).toBe(57.5);
  });

  /**
   * Un tiempo que no se puede calcular no entra en el promedio, y se cuenta
   * aparte. Tratarlo como cero bajaría el promedio y diría que se carga más
   * rápido de lo que se carga: exactamente el número que alguien va a usar para
   * decidir algo.
   */
  it("las órdenes incompletas no entran al promedio y se cuentan aparte", () => {
    const r = indicadoresDeOrdenes([
      orden("1", "13:00", "13:20", "14:00", "14:15"), // carga 40, predio 75
      orden("2", "15:00", null, null, null), // no aporta nada
    ]);

    expect(r.cantidad).toBe(2);
    expect(r.promedioCarga).toBe(40);
    expect(r.promedioPredio).toBe(75);
    expect(r.sinTiempoDeCarga).toBe(1);
    expect(r.sinTiempoEnPredio).toBe(1);
  });

  it("sin nada que promediar el promedio es null y no cero", () => {
    const r = indicadoresDeOrdenes([]);
    expect(r).toEqual({
      cantidad: 0,
      promedioCarga: null,
      promedioPredio: null,
      sinTiempoDeCarga: 0,
      sinTiempoEnPredio: 0,
      peoresEnPredio: [],
    });
  });

  it("los peores en predio salen ordenados de mayor a menor", () => {
    const r = indicadoresDeOrdenes([
      orden("1", "13:00", "13:20", "14:00", "14:15"), // predio 75
      orden("2", "15:00", "15:10", "15:30", "18:00"), // predio 180
      orden("3", "09:00", "09:05", "09:20", "09:30"), // predio 30
    ]);

    expect(r.peoresEnPredio.map((p) => p.numero)).toEqual(["2", "1", "3"]);
    expect(r.peoresEnPredio[0].minutos).toBe(180);
  });

  /** Un negativo es un error de carga: se muestra, no se promedia como si fuera un tiempo. */
  it("un tiempo negativo no se cuela en el promedio", () => {
    const r = indicadoresDeOrdenes([
      orden("1", "13:00", "13:20", "14:00", "14:15"), // carga 40
      orden("2", "15:00", "15:30", "15:10", "15:40"), // carga -20
    ]);

    expect(r.promedioCarga).toBe(40);
    expect(r.sinTiempoDeCarga).toBe(1);
  });
});
