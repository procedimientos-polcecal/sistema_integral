import { describe, expect, it } from "vitest";
import { llegadoElDia, llegadoEnElMes, plantaDelDestino, toneladasLlegadasPorDiaYPlanta } from "./cruceCantera";

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

describe("toneladasLlegadasPorDiaYPlanta / llegadoElDia", () => {
  it("suma las pesadas del mismo día y planta, ignora las que no son de una planta", () => {
    const totales = toneladasLlegadasPorDiaYPlanta([
      { fecha: "2026-06-02", destino: "PT 1", toneladas: 30 },
      { fecha: "2026-06-02", destino: "P T 1", toneladas: 20 },
      { fecha: "2026-06-02", destino: "RESERVA A", toneladas: 999 },
      { fecha: "2026-06-03", destino: "PT 1", toneladas: 15 },
    ]);
    expect(llegadoElDia(totales, "1", "2026-06-02")).toBe(50);
    expect(llegadoElDia(totales, "1", "2026-06-03")).toBe(15);
  });

  it("un día sin ninguna pesada da 0, no null — 'no llegó nada' es un dato", () => {
    const totales = toneladasLlegadasPorDiaYPlanta([]);
    expect(llegadoElDia(totales, "1", "2026-06-02")).toBe(0);
  });
});

describe("llegadoEnElMes", () => {
  it("suma todos los días del mes de esa planta, sin contar otra planta ni otro mes", () => {
    const totales = toneladasLlegadasPorDiaYPlanta([
      { fecha: "2026-06-02", destino: "PT 1", toneladas: 30 },
      { fecha: "2026-06-15", destino: "PT 1", toneladas: 20 },
      { fecha: "2026-07-01", destino: "PT 1", toneladas: 999 },
      { fecha: "2026-06-02", destino: "PT 2", toneladas: 888 },
    ]);
    expect(llegadoEnElMes(totales, "1", "2026-06")).toBe(50);
  });
});
