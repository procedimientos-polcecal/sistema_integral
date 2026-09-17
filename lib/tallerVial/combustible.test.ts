import { describe, it, expect } from "vitest";
import { calcularTrabajoEntreCargas, resumenMensualPorEquipo, type CargaPlana } from "./combustible";

function carga(p: Partial<CargaPlana>): CargaPlana {
  return { id: "x", equipoId: "EM5", fecha: "2026-09-01", litros: 100, lectura: null, ...p };
}

describe("calcularTrabajoEntreCargas", () => {
  it("la primera carga de un equipo no tiene trabajado, aunque tenga lectura", () => {
    const [fila] = calcularTrabajoEntreCargas([carga({ lectura: 9101 })]);
    expect(fila.trabajado).toBeNull();
    expect(fila.consumoPorUnidad).toBeNull();
  });

  it("la segunda carga calcula el delta contra la primera", () => {
    const filas = calcularTrabajoEntreCargas([
      carga({ id: "a", fecha: "2026-09-01", lectura: 9101, litros: 93 }),
      carga({ id: "b", fecha: "2026-09-03", lectura: 9114, litros: 131 }),
    ]);
    const segunda = filas.find((f) => f.id === "b")!;
    expect(segunda.trabajado).toBe(13);
    expect(segunda.consumoPorUnidad).toBeCloseTo(131 / 13, 3);
  });

  it("una carga sin lectura en el medio no corta la cadena", () => {
    const filas = calcularTrabajoEntreCargas([
      carga({ id: "a", fecha: "2026-09-01", lectura: 100, litros: 50 }),
      carga({ id: "b", fecha: "2026-09-05", lectura: null, litros: 30 }), // sin horómetro anotado
      carga({ id: "c", fecha: "2026-09-10", lectura: 150, litros: 60 }),
    ]);
    const b = filas.find((f) => f.id === "b")!;
    const c = filas.find((f) => f.id === "c")!;
    expect(b.trabajado).toBeNull(); // esta carga no tiene lectura propia
    expect(c.trabajado).toBe(50); // encadena contra la última CON lectura (a), no contra b
  });

  it("dos equipos no se mezclan entre sí", () => {
    const filas = calcularTrabajoEntreCargas([
      carga({ id: "a", equipoId: "EM5", fecha: "2026-09-01", lectura: 100 }),
      carga({ id: "b", equipoId: "EM2", fecha: "2026-09-01", lectura: 500 }),
      carga({ id: "c", equipoId: "EM5", fecha: "2026-09-05", lectura: 120 }),
    ]);
    expect(filas.find((f) => f.id === "c")!.trabajado).toBe(20);
  });

  it("un trabajado en cero o negativo (horómetro reseteado o mal anotado) no da consumo", () => {
    const filas = calcularTrabajoEntreCargas([
      carga({ id: "a", fecha: "2026-09-01", lectura: 200 }),
      carga({ id: "b", fecha: "2026-09-05", lectura: 190 }), // menor que la anterior
    ]);
    const b = filas.find((f) => f.id === "b")!;
    expect(b.trabajado).toBe(-10);
    expect(b.consumoPorUnidad).toBeNull();
  });
});

describe("resumenMensualPorEquipo", () => {
  it("suma litros y trabajado del mes, por equipo", () => {
    const conTrabajo = calcularTrabajoEntreCargas([
      carga({ id: "a", equipoId: "EM4", fecha: "2026-09-01", lectura: 100, litros: 200 }),
      carga({ id: "b", equipoId: "EM4", fecha: "2026-09-15", lectura: 175, litros: 370 }),
    ]);
    const [resumen] = resumenMensualPorEquipo(conTrabajo, "2026-09");
    expect(resumen.equipoId).toBe("EM4");
    expect(resumen.cargas).toBe(2);
    expect(resumen.litrosTotal).toBe(570);
    expect(resumen.trabajadoTotal).toBe(75);
    expect(resumen.consumoPromedio).toBeCloseTo(570 / 75, 3);
  });

  it("sin ningún trabajado calculable en el mes, el consumo promedio es null y no cero", () => {
    const conTrabajo = calcularTrabajoEntreCargas([carga({ id: "a", fecha: "2026-09-01", litros: 100, lectura: null })]);
    const [resumen] = resumenMensualPorEquipo(conTrabajo, "2026-09");
    expect(resumen.trabajadoTotal).toBeNull();
    expect(resumen.consumoPromedio).toBeNull();
    expect(resumen.litrosTotal).toBe(100); // los litros sí se cuentan aunque no haya lectura
  });

  it("filtra por mes, dejando afuera cargas de otros meses", () => {
    const conTrabajo = calcularTrabajoEntreCargas([
      carga({ id: "a", fecha: "2026-08-30", litros: 100 }),
      carga({ id: "b", fecha: "2026-09-01", litros: 200 }),
    ]);
    const resumen = resumenMensualPorEquipo(conTrabajo, "2026-09");
    expect(resumen).toHaveLength(1);
    expect(resumen[0].litrosTotal).toBe(200);
  });
});
