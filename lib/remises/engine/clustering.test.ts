import { describe, it, expect } from "vitest";
import { kMeans, clusterConCapacidad } from "./clustering";
import type { Punto } from "./geo";

describe("kMeans", () => {
  it("cuando k >= cantidad de puntos, asigna un cluster único por punto (determinístico)", () => {
    const puntos: Punto[] = [
      { lat: -34.6, lng: -58.4 },
      { lat: -34.7, lng: -58.5 },
      { lat: -34.8, lng: -58.6 },
    ];
    expect(kMeans(puntos, 5)).toEqual([0, 1, 2]);
    expect(kMeans(puntos, 3)).toEqual([0, 1, 2]);
  });

  it("asigna todos los puntos a un cluster válido (0..k-1)", () => {
    const puntos: Punto[] = Array.from({ length: 20 }, (_, i) => ({
      lat: -34.6 + i * 0.01,
      lng: -58.4 + (i % 3) * 0.02,
    }));
    for (let intento = 0; intento < 10; intento++) {
      const asignacion = kMeans(puntos, 4);
      expect(asignacion).toHaveLength(20);
      asignacion.forEach((c) => {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(4);
      });
    }
  });

  it("agrupa puntos geográficamente cercanos en el mismo cluster más seguido que lejanos", () => {
    // Dos grupos bien separados: debería tender a separarlos en clusters distintos.
    const grupoA: Punto[] = [
      { lat: -34.60, lng: -58.40 },
      { lat: -34.601, lng: -58.401 },
      { lat: -34.602, lng: -58.399 },
    ];
    const grupoB: Punto[] = [
      { lat: -35.60, lng: -59.40 },
      { lat: -35.601, lng: -59.401 },
      { lat: -35.602, lng: -59.399 },
    ];
    const puntos = [...grupoA, ...grupoB];
    let mismClusterDentroDeA = 0;
    const intentos = 10;
    for (let i = 0; i < intentos; i++) {
      const asignacion = kMeans(puntos, 2);
      if (asignacion[0] === asignacion[1] && asignacion[1] === asignacion[2]) mismClusterDentroDeA++;
    }
    expect(mismClusterDentroDeA).toBeGreaterThan(intentos / 2);
  });
});

describe("clusterConCapacidad", () => {
  it("sin vehículos, devuelve array vacío", () => {
    expect(clusterConCapacidad([{ lat: 0, lng: 0 }], [])).toEqual([]);
  });

  it("con un solo vehículo, todos van al cluster 0", () => {
    const puntos: Punto[] = Array.from({ length: 5 }, (_, i) => ({ lat: i * 0.01, lng: i * 0.01 }));
    expect(clusterConCapacidad(puntos, [8])).toEqual([0, 0, 0, 0, 0]);
  });

  it("respeta la capacidad de cada vehículo cuando hay espacio suficiente", () => {
    const puntos: Punto[] = Array.from({ length: 12 }, (_, i) => ({
      lat: -34.6 + i * 0.01,
      lng: -58.4 + (i % 4) * 0.02,
    }));
    const capacidades = [5, 5, 5]; // total 15 >= 12
    for (let intento = 0; intento < 10; intento++) {
      const asignacion = clusterConCapacidad(puntos, capacidades);
      const conteos = [0, 0, 0];
      asignacion.forEach((c) => conteos[c]++);
      conteos.forEach((c, i) => expect(c).toBeLessThanOrEqual(capacidades[i]));
    }
  });

  it("asigna a todos los empleados aunque la capacidad total no alcance", () => {
    const puntos: Punto[] = Array.from({ length: 10 }, (_, i) => ({ lat: i * 0.01, lng: i * 0.01 }));
    const asignacion = clusterConCapacidad(puntos, [2, 2]); // total 4 < 10
    expect(asignacion).toHaveLength(10);
    asignacion.forEach((c) => expect([0, 1]).toContain(c));
  });
});
