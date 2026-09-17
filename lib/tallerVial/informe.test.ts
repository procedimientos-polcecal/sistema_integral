import { describe, it, expect } from "vitest";
import { armarInformeConsumo, armarInformeDisponibilidad } from "./informe";
import { calcularTrabajoEntreCargas, type CargaPlana } from "./combustible";
import type { ResumenMensualDeEstado } from "./estados";

function carga(p: Partial<CargaPlana>): CargaPlana {
  return { id: "x", equipoId: "EM4", fecha: "2026-09-01", litros: 100, lectura: null, ...p };
}

describe("armarInformeConsumo", () => {
  // Mismo criterio que `resumenMensualPorEquipo`: los litros del mes se suman
  // todos, y el consumo se mide contra el total de horas trabajadas que sí se
  // pudieron calcular — no sólo las de la carga que tiene trabajado propio.
  it("suma los litros del mes contra el total de horas trabajadas del mes", () => {
    const cargas = calcularTrabajoEntreCargas([
      carga({ id: "a", fecha: "2026-08-20", lectura: 7000, litros: 400 }), // semilla del mes anterior
      carga({ id: "b", fecha: "2026-09-01", lectura: 7050, litros: 300 }), // 50 hs desde la semilla
      carga({ id: "c", fecha: "2026-09-10", lectura: 7125, litros: 270 }), // 75 hs desde la anterior
    ]);
    const [fila] = armarInformeConsumo(cargas, "2026-09");
    expect(fila.equipoId).toBe("EM4");
    expect(fila.cargas).toBe(2);
    expect(fila.litrosTotal).toBe(570);
    expect(fila.consumoDelMes).toBeCloseTo(570 / 125, 3); // 50 + 75 hs trabajadas en septiembre
  });

  it("la referencia histórica sale de los meses anteriores, no del mes del informe", () => {
    const cargas = calcularTrabajoEntreCargas([
      carga({ id: "a", fecha: "2026-07-01", lectura: 1000, litros: 100 }), // primera carga del equipo: sin trabajado propio
      carga({ id: "b", fecha: "2026-08-01", lectura: 1100, litros: 1000 }), // 100 hs desde julio
      carga({ id: "c", fecha: "2026-09-01", lectura: 1200, litros: 100 }), // 100 hs, no debería mezclarse con la referencia
    ]);
    const [fila] = armarInformeConsumo(cargas, "2026-09", 6);
    expect(fila.consumoDelMes).toBeCloseTo(1, 3);
    // 100 (julio) + 1000 (agosto) = 1100 litros, sobre las 100 hs que sí se
    // pudieron calcular (agosto) — julio no aporta hs porque es la primera carga.
    expect(fila.referenciaHistorica).toBeCloseTo(11, 3);
    expect(fila.desvio).toBeCloseTo(1 - 11, 3);
  });

  it("sin meses de referencia, la referencia y el desvío quedan en null, no en cero", () => {
    const cargas = calcularTrabajoEntreCargas([
      carga({ id: "a", fecha: "2026-09-01", lectura: 100, litros: 50 }),
      carga({ id: "b", fecha: "2026-09-10", lectura: 150, litros: 60 }),
    ]);
    const [fila] = armarInformeConsumo(cargas, "2026-09");
    expect(fila.consumoDelMes).not.toBeNull();
    expect(fila.referenciaHistorica).toBeNull();
    expect(fila.desvio).toBeNull();
  });
});

describe("armarInformeDisponibilidad", () => {
  it("el semáforo respeta los umbrales de la hoja real: <70% crítico, 70-84% aceptable, ≥85% bueno", () => {
    const resumen: ResumenMensualDeEstado[] = [
      { equipoId: "A", diasRegistrados: 30, diasOperativo: 20, diasFueraDeServicio: 10, diasConFallas: 0 }, // 66.7%
      { equipoId: "B", diasRegistrados: 30, diasOperativo: 24, diasFueraDeServicio: 6, diasConFallas: 0 }, // 80%
      { equipoId: "C", diasRegistrados: 30, diasOperativo: 27, diasFueraDeServicio: 3, diasConFallas: 0 }, // 90%
    ];
    const filas = armarInformeDisponibilidad(resumen);
    expect(filas.find((f) => f.equipoId === "A")!.lectura).toBe("CRITICO");
    expect(filas.find((f) => f.equipoId === "B")!.lectura).toBe("ACEPTABLE");
    expect(filas.find((f) => f.equipoId === "C")!.lectura).toBe("BUENO");
  });

  it("sin ningún día registrado, no hay % ni lectura", () => {
    const [fila] = armarInformeDisponibilidad([
      { equipoId: "A", diasRegistrados: 0, diasOperativo: 0, diasFueraDeServicio: 0, diasConFallas: 0 },
    ]);
    expect(fila.disponibilidadPct).toBeNull();
    expect(fila.lectura).toBeNull();
  });
});
