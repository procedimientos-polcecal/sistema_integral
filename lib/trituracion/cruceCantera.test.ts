import { describe, expect, it } from "vitest";
import { llegadaDelDia, llegadasPorDiaYPlanta, llegadoEnElMes, plantaDelDestino } from "./cruceCantera";

describe("plantaDelDestino", () => {
  it("resuelve las variantes reales de la balanza", () => {
    expect(plantaDelDestino("PT 1")).toBe("1");
    expect(plantaDelDestino("P T 1")).toBe("1");
    expect(plantaDelDestino("PT 3")).toBe("3");
    expect(plantaDelDestino("P T 3")).toBe("3");
    expect(plantaDelDestino("PT 2")).toBe("2");
  });

  it("no confunde otros destinos con una planta", () => {
    expect(plantaDelDestino("RESERVA A")).toBeNull();
    expect(plantaDelDestino("GALPON 2")).toBeNull();
    expect(plantaDelDestino("PAVONE")).toBeNull();
    expect(plantaDelDestino("D1")).toBeNull();
  });

  it("null o vacío da null", () => {
    expect(plantaDelDestino(null)).toBeNull();
    expect(plantaDelDestino("")).toBeNull();
  });
});

describe("llegadasPorDiaYPlanta / llegadaDelDia", () => {
  it("suma el total y desglosa por tipo, de mayor a menor", () => {
    const totales = llegadasPorDiaYPlanta([
      { fecha: "2026-06-02", destino: "PT 1", toneladas: 30, tipo: "dolomita_d1" },
      { fecha: "2026-06-02", destino: "P T 1", toneladas: 20, tipo: "dolomita_d1" },
      { fecha: "2026-06-02", destino: "PT 1", toneladas: 35, tipo: "chocolata_3" },
      { fecha: "2026-06-02", destino: "RESERVA A", toneladas: 999, tipo: "caliza" },
      { fecha: "2026-06-03", destino: "PT 1", toneladas: 15, tipo: "caliza" },
    ]);

    const dia2 = llegadaDelDia(totales, "1", "2026-06-02");
    expect(dia2.total).toBe(85);
    expect(dia2.porTipo).toEqual([
      { tipo: "dolomita_d1", toneladas: 50 },
      { tipo: "chocolata_3", toneladas: 35 },
    ]);

    expect(llegadaDelDia(totales, "1", "2026-06-03").total).toBe(15);
  });

  it("una pesada sin tipo suma al total pero no aparece en el desglose", () => {
    const totales = llegadasPorDiaYPlanta([
      { fecha: "2026-06-02", destino: "PT 1", toneladas: 10, tipo: null },
    ]);
    const dia = llegadaDelDia(totales, "1", "2026-06-02");
    expect(dia.total).toBe(10);
    expect(dia.porTipo).toEqual([]);
  });

  it("un día sin ninguna pesada da total 0 y porTipo vacío, no null", () => {
    const totales = llegadasPorDiaYPlanta([]);
    const dia = llegadaDelDia(totales, "1", "2026-06-02");
    expect(dia.total).toBe(0);
    expect(dia.porTipo).toEqual([]);
  });
});

describe("llegadoEnElMes", () => {
  it("suma todos los días del mes de esa planta, sin contar otra planta ni otro mes", () => {
    const totales = llegadasPorDiaYPlanta([
      { fecha: "2026-06-02", destino: "PT 1", toneladas: 30, tipo: "dolomita_d1" },
      { fecha: "2026-06-15", destino: "PT 1", toneladas: 20, tipo: "caliza" },
      { fecha: "2026-07-01", destino: "PT 1", toneladas: 999, tipo: "caliza" },
      { fecha: "2026-06-02", destino: "PT 2", toneladas: 888, tipo: "caliza" },
    ]);
    expect(llegadoEnElMes(totales, "1", "2026-06")).toBe(50);
  });
});
