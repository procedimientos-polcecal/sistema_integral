import { describe, expect, it } from "vitest";
import { indicadoresDe } from "./indicadores";
import type { TurnoDeRobot } from "./turnos";

function turno(p: Partial<TurnoDeRobot> = {}): TurnoDeRobot {
  return {
    fecha: "2026-10-01",
    turno: "04_12",
    kg: 0,
    minutosMarcha: 0,
    minutosTeoricos: 480,
    estado: "normal",
    porMaterial: {},
    ...p,
  };
}

/** El helper del pliego: kg, marcha y teórica con nombres cortos. */
function t(p: { kg?: number; marcha?: number; teorica?: number; estado?: TurnoDeRobot["estado"] }) {
  return turno({ kg: p.kg, minutosMarcha: p.marcha, minutosTeoricos: p.teorica, estado: p.estado });
}

describe("indicadoresDe", () => {
  it("utilizacion es marcha sobre teorica, productividad es toneladas sobre marcha", () => {
    const i = indicadoresDe([t({ kg: 48000, marcha: 240, teorica: 480 })], []);
    expect(i.toneladas).toBe(48);
    expect(i.horasDeMarcha).toBe(4);
    expect(i.horasNoTrabajadas).toBe(4);
    expect(i.utilizacion).toBeCloseTo(0.5, 6);
    expect(i.productividad).toBeCloseTo(12, 6);
  });

  it("un turno inconsistente aporta sus toneladas y no sus horas", () => {
    const i = indicadoresDe(
      [
        t({ kg: 10000, marcha: 240, teorica: 240, estado: "normal" }),
        t({ kg: 90000, marcha: 498, teorica: 480, estado: "inconsistente" }),
      ],
      [],
    );
    expect(i.toneladas).toBe(100);
    expect(i.horasDeMarcha).toBe(4);
    expect(i.horasNoTrabajadas).toBe(0);
    expect(i.utilizacion).toBeCloseTo(1, 6);
  });

  it("un turno huerfano no aporta nada, ni toneladas ni horas", () => {
    // Con valores en cero este caso pasaría aunque el huérfano contara: se le
    // ponen cifras para que contarlo se note en las tres cuentas.
    const i = indicadoresDe(
      [
        t({ kg: 20000, marcha: 120, teorica: 240, estado: "normal" }),
        t({ kg: 7000, marcha: 100, teorica: 480, estado: "huerfano" }),
      ],
      [],
    );
    expect(i.toneladas).toBe(20);
    expect(i.horasDeMarcha).toBe(2);
    expect(i.horasNoTrabajadas).toBe(2);
    expect(i.utilizacion).toBeCloseTo(0.5, 6);
  });

  it("solo huerfanos: todo en cero y las razones en null", () => {
    const i = indicadoresDe([t({ estado: "huerfano", kg: 0, marcha: 0, teorica: 0 })], []);
    expect(i.toneladas).toBe(0);
    expect(i.utilizacion).toBeNull();
    expect(i.productividad).toBeNull();
  });

  it("un turno acumulado aporta todo, con la duracion teorica de su racha", () => {
    // Un bloque de 480 más los dos de 240 que faltaban antes: 960 teóricos.
    const i = indicadoresDe([t({ kg: 96000, marcha: 720, teorica: 960, estado: "acumulado" })], []);
    expect(i.toneladas).toBe(96);
    expect(i.horasDeMarcha).toBe(12);
    expect(i.horasNoTrabajadas).toBe(4);
    expect(i.utilizacion).toBeCloseTo(0.75, 6);
    expect(i.productividad).toBeCloseTo(8, 6);
  });

  it("un molino parado todo el periodo da utilizacion 0 y no null", () => {
    // Hay denominador (el molino debió trabajar) y la marcha es cero: es un dato.
    const i = indicadoresDe([t({ kg: 0, marcha: 0, teorica: 480 })], []);
    expect(i.utilizacion).toBe(0);
    expect(i.horasNoTrabajadas).toBe(8);
    expect(i.productividad).toBeNull();
  });

  it("sin horas teoricas devuelve null y no cero", () => {
    const i = indicadoresDe([], []);
    expect(i.utilizacion).toBeNull();
    expect(i.productividad).toBeNull();
    expect(i.toneladas).toBe(0);
    expect(i.horasDeMarcha).toBe(0);
    expect(i.horasNoTrabajadas).toBe(0);
  });

  it("solo turnos inconsistentes: hay toneladas pero no con que calcular las razones", () => {
    const i = indicadoresDe([t({ kg: 50000, marcha: 498, teorica: 480, estado: "inconsistente" })], []);
    expect(i.toneladas).toBe(50);
    expect(i.utilizacion).toBeNull();
    expect(i.productividad).toBeNull();
  });

  it("cuenta los dias no operativos sin tocar el resto", () => {
    const i = indicadoresDe([t({ kg: 1000, marcha: 60, teorica: 480 })], ["2026-10-04", "2026-10-11"]);
    expect(i.diasNoOperativos).toBe(2);
    expect(i.horasDeMarcha).toBe(1);
  });
});
