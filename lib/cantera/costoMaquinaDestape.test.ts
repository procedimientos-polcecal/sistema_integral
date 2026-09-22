import { describe, expect, it } from "vitest";
import { costoHoraDeMaquina, esMesCerrado } from "./costoMaquinaDestape";

describe("costoHoraDeMaquina", () => {
  it("combina gasto de Odoo + combustible estimado, dividido horas del mes", () => {
    const r = costoHoraDeMaquina({
      gastoAnaliticoOdoo: 100_000,
      litrosDelMes: 200,
      gastoCombustibleDelTipo: 728_000,
      litrosDelTipo: 1000,
      horasDelMes: 50,
    });
    // precio implícito = 728000/1000 = 728 $/litro; combustible de la máquina = 200*728 = 145600
    expect(r.precioImplicitoLitro).toBe(728);
    expect(r.estimadoCombustible).toBe(145_600);
    expect(r.costoHora).toBeCloseTo((100_000 + 145_600) / 50, 6);
  });

  it("sin horas de uso ese mes, costoHora es null — no vale mostrar $0", () => {
    const r = costoHoraDeMaquina({
      gastoAnaliticoOdoo: 50_000, litrosDelMes: 10, gastoCombustibleDelTipo: 100_000, litrosDelTipo: 500, horasDelMes: null,
    });
    expect(r.costoHora).toBeNull();
  });

  it("horasDelMes en 0 también da costoHora null (no divide por cero)", () => {
    const r = costoHoraDeMaquina({
      gastoAnaliticoOdoo: 50_000, litrosDelMes: 10, gastoCombustibleDelTipo: 100_000, litrosDelTipo: 500, horasDelMes: 0,
    });
    expect(r.costoHora).toBeNull();
  });

  it("sin litros cargados de ese tipo en toda la flota, no hay precio implícito y el combustible estimado es 0", () => {
    const r = costoHoraDeMaquina({
      gastoAnaliticoOdoo: 80_000, litrosDelMes: 50, gastoCombustibleDelTipo: 0, litrosDelTipo: 0, horasDelMes: 20,
    });
    expect(r.precioImplicitoLitro).toBeNull();
    expect(r.estimadoCombustible).toBe(0);
    expect(r.costoHora).toBeCloseTo(80_000 / 20, 6);
  });

  it("sin ningún gasto (ni Odoo ni combustible) pero con horas, costoHora da 0 — no null", () => {
    const r = costoHoraDeMaquina({
      gastoAnaliticoOdoo: 0, litrosDelMes: 0, gastoCombustibleDelTipo: 0, litrosDelTipo: 0, horasDelMes: 30,
    });
    expect(r.costoHora).toBe(0);
  });
});

describe("esMesCerrado", () => {
  it("un mes anterior al actual está cerrado", () => {
    expect(esMesCerrado("2026-08", "2026-09")).toBe(true);
    expect(esMesCerrado("2025-12", "2026-01")).toBe(true);
  });

  it("el mes en curso no está cerrado", () => {
    expect(esMesCerrado("2026-09", "2026-09")).toBe(false);
  });

  it("un mes futuro tampoco está cerrado", () => {
    expect(esMesCerrado("2026-10", "2026-09")).toBe(false);
  });
});
