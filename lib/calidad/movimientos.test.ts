import { describe, it, expect } from "vitest";
import { efectoEnElSaldo } from "./movimientos";

describe("efectoEnElSaldo", () => {
  it("una entrada suma", () => {
    expect(efectoEnElSaldo("entrada", 19.58)).toEqual({ toneladas: 19.58, problema: null });
  });

  it("un consumo se carga en positivo y se guarda en negativo", () => {
    expect(efectoEnElSaldo("consumo", 37)).toEqual({ toneladas: -37, problema: null });
  });

  it("un ajuste guarda el signo que se tipeó, en menos", () => {
    // El 20/04/2026 se cargó como "CONSUMO VEGETAL 46" con la nota
    // "AJUSTE DE STOCK (-46 Tn.)". Acá es un ajuste y se ve.
    expect(efectoEnElSaldo("ajuste", -46)).toEqual({ toneladas: -46, problema: null });
  });

  it("un ajuste guarda el signo que se tipeó, en más", () => {
    // El 02/05/2026 el ajuste en más no tuvo dónde entrar y alguien pisó la
    // fórmula del saldo a mano.
    expect(efectoEnElSaldo("ajuste", 232.5)).toEqual({ toneladas: 232.5, problema: null });
  });

  it("una entrada en cero o negativa es un error de carga", () => {
    expect(efectoEnElSaldo("entrada", 0).problema).toBeTruthy();
    expect(efectoEnElSaldo("entrada", -5).problema).toBeTruthy();
  });

  it("un consumo en negativo es un error de carga, no un ajuste encubierto", () => {
    expect(efectoEnElSaldo("consumo", -5).problema).toBeTruthy();
    expect(efectoEnElSaldo("consumo", 0).problema).toBeTruthy();
  });

  it("un ajuste de cero no es un ajuste", () => {
    expect(efectoEnElSaldo("ajuste", 0).problema).toBeTruthy();
  });

  it("lo que no es número se rechaza y no se convierte en NaN", () => {
    expect(efectoEnElSaldo("consumo", NaN).problema).toBeTruthy();
    expect(efectoEnElSaldo("consumo", Infinity).problema).toBeTruthy();
  });

  it("redondea a tres decimales, que es lo que guarda la base", () => {
    expect(efectoEnElSaldo("entrada", 19.5789).toneladas).toBe(19.579);
  });
});

import { saldosDelLibro, saldoCorrido } from "./movimientos";

const mov = (carbon: string, toneladas: number, fecha = "2026-01-01", cargado_en = "2026-01-01T10:00:00Z") =>
  ({ carbon, toneladas, fecha, cargado_en }) as never;

describe("saldosDelLibro", () => {
  it("suma por tipo y despeja el total", () => {
    expect(
      saldosDelLibro([mov("vegetal", 20), mov("vegetal", -15), mov("residual", 25)])
    ).toEqual({ vegetal: 5, residual: 25, total: 30 });
  });

  it("los sin_separar no caen en ningun saldo", () => {
    // Los once meses importados de antes del 15/12/2025 suman un numero enorme
    // y negativo --siete de esos meses son consumo sin un solo camion-- y no
    // son el stock de nada.
    expect(
      saldosDelLibro([mov("vegetal", 100), mov("sin_separar", -5000)])
    ).toEqual({ vegetal: 100, residual: 0, total: 100 });
  });

  it("un saldo negativo se ve y no se corrige solo", () => {
    // El residual llego a -0,47 el 19/08/2026 y era real.
    expect(saldosDelLibro([mov("residual", 10), mov("residual", -10.47)]).residual).toBe(-0.47);
  });

  it("no arrastra ruido de coma flotante", () => {
    // La planilla vieja mostraba 355.8569999999998 por acumular en la celda.
    expect(saldosDelLibro([mov("vegetal", 0.1), mov("vegetal", 0.2)]).vegetal).toBe(0.3);
  });

  it("un libro vacio es cero y no es un error", () => {
    expect(saldosDelLibro([])).toEqual({ vegetal: 0, residual: 0, total: 0 });
  });
});

describe("saldoCorrido", () => {
  it("devuelve cada movimiento con el saldo despues de el, por fecha y luego por carga", () => {
    const filas = saldoCorrido([
      mov("vegetal", -10, "2026-01-02", "2026-01-02T18:00:00Z"),
      mov("vegetal", 20, "2026-01-01", "2026-01-01T09:00:00Z"),
      mov("residual", 5, "2026-01-02", "2026-01-02T08:00:00Z"),
    ]);
    expect(filas.map((f) => [f.fecha, f.saldoVegetal, f.saldoResidual, f.saldoTotal])).toEqual([
      ["2026-01-01", 20, 0, 20],
      ["2026-01-02", 20, 5, 25],
      ["2026-01-02", 10, 5, 15],
    ]);
  });

  it("los sin_separar no mueven los dos saldos", () => {
    const filas = saldoCorrido([mov("sin_separar", -40, "2025-06-01"), mov("vegetal", 8, "2026-01-01")]);
    expect(filas.map((f) => f.saldoTotal)).toEqual([0, 8]);
  });
});
