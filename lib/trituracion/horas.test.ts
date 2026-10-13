import { describe, expect, it } from "vitest";
import { despejarParte, horasTeoricas } from "./horas";

describe("horasTeoricas", () => {
  it("calcula la duración entre inicio y fin", () => {
    expect(horasTeoricas("04:40", "11:30")).toBeCloseTo(6.8333, 3);
  });

  it("da null si falta un horario", () => {
    expect(horasTeoricas(null, "11:30")).toBeNull();
    expect(horasTeoricas("04:40", null)).toBeNull();
  });

  it("da null si el fin es antes que el inicio (no cruza medianoche)", () => {
    expect(horasTeoricas("11:30", "04:40")).toBeNull();
  });
});

describe("despejarParte", () => {
  it("reproduce la fila real de PLANTA 1 del 2/6/2026", () => {
    const r = despejarParte({
      horaInicio: "04:40",
      horaFin: "11:30",
      horasMantenimiento: 0,
      horasFaltaPiedra: 1.1666666666666667,
      horasProduccion: 0,
      horasOtro: 0,
      toneladasProcesadas: 542,
      camionesLlegados: 44,
    });

    expect(r.horasTeoricas).toBeCloseTo(6.8333, 3);
    expect(r.horasRealesTrabajadas).toBeCloseTo(5.6667, 3);
    expect(r.disponibilidad).toBeCloseTo(0.8293, 3);
    expect(r.tonPorCamion).toBeCloseTo(12.318, 2);
    expect(r.productividadAbsoluta).toBeCloseTo(79.317, 2);
    expect(r.productividadReal).toBeCloseTo(95.647, 2);
  });

  it("sin horario no hay teóricas ni reales ni disponibilidad, aunque haya toneladas", () => {
    const r = despejarParte({
      horaInicio: null,
      horaFin: null,
      horasMantenimiento: 0,
      horasFaltaPiedra: 0,
      horasProduccion: 0,
      horasOtro: 0,
      toneladasProcesadas: 500,
      camionesLlegados: 10,
    });
    expect(r.horasTeoricas).toBeNull();
    expect(r.horasRealesTrabajadas).toBeNull();
    expect(r.disponibilidad).toBeNull();
    expect(r.productividadAbsoluta).toBeNull();
    // ton/camión no depende del horario
    expect(r.tonPorCamion).toBe(50);
  });

  it("sin camiones llegados, ton/camión es null y no divide por cero", () => {
    const r = despejarParte({
      horaInicio: "04:00",
      horaFin: "12:00",
      horasMantenimiento: 0,
      horasFaltaPiedra: 0,
      horasProduccion: 0,
      horasOtro: 0,
      toneladasProcesadas: 500,
      camionesLlegados: 0,
    });
    expect(r.tonPorCamion).toBeNull();
  });

  it("sin toneladas, las productividades son null aunque haya horario", () => {
    const r = despejarParte({
      horaInicio: "04:00",
      horaFin: "12:00",
      horasMantenimiento: 0,
      horasFaltaPiedra: 0,
      horasProduccion: 0,
      horasOtro: 0,
      toneladasProcesadas: null,
      camionesLlegados: 5,
    });
    expect(r.productividadAbsoluta).toBeNull();
    expect(r.productividadReal).toBeNull();
    expect(r.tonPorCamion).toBeNull();
  });

  it("con horas reales en cero, productividad real es null (no divide por cero)", () => {
    const r = despejarParte({
      horaInicio: "04:00",
      horaFin: "12:00",
      horasMantenimiento: 4,
      horasFaltaPiedra: 4,
      horasProduccion: 0,
      horasOtro: 0,
      toneladasProcesadas: 100,
      camionesLlegados: 5,
    });
    expect(r.horasRealesTrabajadas).toBe(0);
    expect(r.productividadReal).toBeNull();
    // pero productividad absoluta sí, porque las teóricas siguen siendo 8
    expect(r.productividadAbsoluta).toBeCloseTo(12.5, 2);
  });
});
