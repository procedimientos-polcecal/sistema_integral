import { describe, it, expect } from "vitest";
import { normalizarFletero, fechaDatosAIso, pesadaDeFilaCruda, agruparPesadasPorFleteroTipoMes } from "./pesadas";
import type { PesadaDB } from "./types";

describe("normalizarFletero", () => {
  it("resuelve por patente entre paréntesis, sin importar el nombre delante", () => {
    expect(normalizarFletero("Amaray (XAG816)")).toBe("Amaray");
    expect(normalizarFletero("Dumerauf 1 (SQV 625)")).toBe("Dumerauf 1");
    expect(normalizarFletero("Orsatti (WVI 773)")).toBe("Orsatti 2");
    expect(normalizarFletero("Orsatti (CBL541)")).toBe("Orsatti 1");
  });

  it("Schneider junta sus dos patentes en un solo fletero", () => {
    expect(normalizarFletero("Schneider 1 (GBL 929)")).toBe("Schneider");
    expect(normalizarFletero("Schneider 2 (VGC 250)")).toBe("Schneider");
  });

  it("por nombre a secas, sólo si no hay con quién confundirlo", () => {
    expect(normalizarFletero("Priola")).toBe("Priola");
    expect(normalizarFletero("Priola2")).toBe("Priola");
    expect(normalizarFletero("Schneider")).toBe("Schneider");
    expect(normalizarFletero("Amaray")).toBe("Amaray");
  });

  it("Dumerauf y Orsatti a secas son ambiguos (hay dos de cada uno) — no se adivina", () => {
    expect(normalizarFletero("Dumerauf")).toBeNull();
    expect(normalizarFletero("Orsatti")).toBeNull();
  });

  it("un nombre que no está en la lista de 11 queda sin resolver", () => {
    expect(normalizarFletero("CONTE GASTON")).toBeNull();
    expect(normalizarFletero("TAIBO RUBEN (SCANIA)")).toBeNull();
    expect(normalizarFletero("Orsatti 3")).toBeNull();
  });

  it("vacío o null, sin fletero", () => {
    expect(normalizarFletero(null)).toBeNull();
    expect(normalizarFletero("")).toBeNull();
    expect(normalizarFletero("  ")).toBeNull();
  });
});

describe("fechaDatosAIso", () => {
  it("d/m/yyyy a ISO, nunca m/d", () => {
    expect(fechaDatosAIso("2/1/2026")).toBe("2026-01-02");
    expect(fechaDatosAIso("13/1/2026")).toBe("2026-01-13");
  });

  it("lo que no tiene esa forma, null", () => {
    expect(fechaDatosAIso("")).toBeNull();
    expect(fechaDatosAIso("2026-01-02")).toBeNull();
  });
});

describe("pesadaDeFilaCruda", () => {
  // La fila real de ejemplo (relevada de la planilla, fila 2 de "Datos").
  const FILA_REAL = [
    "2/1/2026", "8:49", "26820", "7920", "", "18900", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
    "PAVONE", "PT 1", "Amaray", "04-01-2026",
  ];

  it("resuelve la columna de material, la pasa a toneladas, y el fletero por la posición real (no por el título de la columna)", () => {
    const p = pesadaDeFilaCruda(FILA_REAL);
    expect(p).not.toBeNull();
    expect(p!.fecha).toBe("2026-01-02");
    expect(p!.tipo).toBe("dolomita_d6");
    expect(p!.toneladas).toBeCloseTo(18.9, 3);
    expect(p!.origen).toBe("PAVONE");
    expect(p!.destino).toBe("PT 1");
    expect(p!.fleteroRaw).toBe("Amaray");
    expect(p!.fleteroNombre).toBe("Amaray");
  });

  it("una columna de 'Destape' no tiene tipo tarifado, pero la pesada se guarda igual", () => {
    const fila = [...FILA_REAL];
    fila[5] = ""; // saca Dolomita D6
    fila[18] = "12000"; // Destape D1
    const p = pesadaDeFilaCruda(fila);
    expect(p!.tipo).toBeNull();
    expect(p!.toneladas).toBeCloseTo(12, 3);
  });

  it("sin fecha o sin ningún material con neto, no es una pesada", () => {
    expect(pesadaDeFilaCruda(["", ...FILA_REAL.slice(1)])).toBeNull();
    const sinMaterial = [...FILA_REAL];
    sinMaterial[5] = "";
    expect(pesadaDeFilaCruda(sinMaterial)).toBeNull();
  });

  it("un fletero que no se puede resolver deja fleteroNombre en null pero conserva el texto real", () => {
    const fila = [...FILA_REAL];
    fila[23] = "Dumerauf";
    const p = pesadaDeFilaCruda(fila);
    expect(p!.fleteroRaw).toBe("Dumerauf");
    expect(p!.fleteroNombre).toBeNull();
  });
});

describe("agruparPesadasPorFleteroTipoMes", () => {
  function pesada(p: Partial<PesadaDB>): PesadaDB {
    return {
      id: "1", fecha: "2026-01-15", hora: null, bruto: null, tara: null,
      tipo: "dolomita_d1", toneladas: 10, origen: null, destino: null,
      fletero_raw: "x", fletero_id: "f1",
      ...p,
    };
  }

  it("suma toneladas por fletero, tipo y mes", () => {
    const r = agruparPesadasPorFleteroTipoMes([
      pesada({ toneladas: 10 }),
      pesada({ toneladas: 5 }),
      pesada({ fecha: "2026-02-01", toneladas: 3 }),
    ]);
    expect(r).toEqual(
      expect.arrayContaining([
        { fleteroId: "f1", tipo: "dolomita_d1", mes: "2026-01-01", cantidad: 15 },
        { fleteroId: "f1", tipo: "dolomita_d1", mes: "2026-02-01", cantidad: 3 },
      ])
    );
  });

  it("una pesada sin fletero o sin tipo resuelto no entra en ningún total", () => {
    const r = agruparPesadasPorFleteroTipoMes([
      pesada({ fletero_id: null }),
      pesada({ tipo: null }),
    ]);
    expect(r).toEqual([]);
  });
});
