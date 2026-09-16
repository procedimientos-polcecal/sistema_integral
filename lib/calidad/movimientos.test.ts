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
