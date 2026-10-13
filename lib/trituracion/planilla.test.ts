import { describe, expect, it } from "vitest";
import { filaParte, type ParteParaPlanilla } from "./planilla";

const parte: ParteParaPlanilla = {
  fecha: "2026-09-01",
  estado: "opero",
  material: "Chocolata",
  origen: "C1",
  horaInicio: "04:45:00",
  horaFin: "11:30:00",
  horasMantenimiento: 0,
  horasFaltaPiedra: 1.25,
  horasProduccion: 0,
  horasOtro: 0,
  camionesLlegados: 5,
  toneladasProcesadas: 100,
  observaciones: null,
};

describe("filaParte", () => {
  it("con las horas como las devuelve la base (HH:MM:SS) igual calcula las columnas", () => {
    const fila = filaParte(parte);
    expect(fila[4]).toBe("04:45");
    expect(fila[5]).toBe("11:30");
    expect(fila[6]).toBeCloseTo(6.75, 5); // horas teóricas
    expect(fila[12]).toBeCloseTo(5.5, 5); // horas reales
    expect(fila[13]).toBeCloseTo(5.5 / 6.75, 5); // disponibilidad
  });

  it("sin horario deja vacías las columnas que dependen de él", () => {
    const fila = filaParte({ ...parte, horaInicio: null, horaFin: null });
    expect(fila[4]).toBe("");
    expect(fila[6]).toBe("");
    expect(fila[12]).toBe("");
  });
});
