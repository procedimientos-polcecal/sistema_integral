import { describe, it, expect } from "vitest";
import { resumenDelHistorico, type RiPasado } from "./historicoDelArticulo";

const ri = (nro_ri: number, monto: number, proveedor: string | null = null): RiPasado => ({
  nro_ri,
  fecha: null,
  monto_conocido: monto,
  proveedor,
});

describe("resumenDelHistorico", () => {
  it("sin historia no dice nada", () => {
    expect(resumenDelHistorico([])).toBeNull();
  });

  it("con un solo pedido anterior, ése es el último", () => {
    const r = resumenDelHistorico([ri(2063, 16_885_438, "BOLSAS OLAVARRÍA")]);
    expect(r).toEqual({
      veces: 1,
      ultimo: ri(2063, 16_885_438, "BOLSAS OLAVARRÍA"),
      maximo: 16_885_438,
      minimo: 16_885_438,
    });
  });

  /**
   * El último es el de N° de RI más alto y no el de fecha más reciente: la
   * fecha puede venir vacía —son 2.159 filas traídas de una planilla— y el
   * número es la única cronología que el módulo tiene siempre.
   */
  it("el último es el de número más alto, aunque llegue desordenado", () => {
    const r = resumenDelHistorico([ri(698, 12_000_000), ri(2063, 16_885_438), ri(352, 9_000_000)]);
    expect(r?.ultimo.nro_ri).toBe(2063);
    expect(r?.veces).toBe(3);
  });

  /**
   * El máximo y el mínimo van los dos porque son la diferencia entre "esto
   * cuesta 16 millones" y "esto costó entre 300 mil y 16 millones, fijate".
   * Medido: de los 26 grupos repetidos, 10 fueron caros a veces y baratos
   * otras, así que el rango es lo que impide leer un número como una promesa.
   */
  it("dice el máximo y el mínimo, que es lo que muestra si el precio salta", () => {
    const r = resumenDelHistorico([ri(100, 300_000), ri(200, 16_885_438), ri(300, 1_200_000)]);
    expect(r?.maximo).toBe(16_885_438);
    expect(r?.minimo).toBe(300_000);
  });

  it("un solo pedido tiene máximo y mínimo iguales, y eso no es un rango", () => {
    const r = resumenDelHistorico([ri(100, 500_000)]);
    expect(r?.maximo).toBe(r?.minimo);
  });
});
