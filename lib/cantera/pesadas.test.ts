import { describe, it, expect } from "vitest";
import {
  normalizarFletero,
  fechaDatosAIso,
  pesadaDeFilaCruda,
  agruparPesadasPorFleteroTipoMes,
  agruparPesadasPorTipoMes,
  planasDesdePesadasAgrupadas,
  sumarPesadasAgrupadasPorTipoMes,
  toneladasPorYacimientoDesdePesadas,
  patentesParaMostrar,
  toneladasDeOrigenesExternos,
  toneladasDolomitaD1DePlanta2PorMes,
  sumarAcarreosPorYacimiento,
} from "./pesadas";
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

describe("toneladasPorYacimientoDesdePesadas", () => {
  it("suma por el ORIGEN real, no por el nombre del material", () => {
    const r = toneladasPorYacimientoDesdePesadas([
      { fecha: "2026-08-01", origen: "C1", toneladas: 100 }, // caliza, chocolata, lo que sea: vino de C1
      { fecha: "2026-08-15", origen: "c1", toneladas: 50 }, // minúscula, mismo yacimiento
      { fecha: "2026-08-20", origen: "D1", toneladas: 30 },
    ]);
    expect(r).toEqual([
      { yacimientoCodigo: "C1", mes: "2026-08", toneladas: 150 },
      { yacimientoCodigo: "D1", mes: "2026-08", toneladas: 30 },
    ]);
  });

  it("no depende de si la pesada tiene fletero resuelto — de dónde vino la piedra no es de quién la trajo", () => {
    // Ninguna de estas pesadas trae fletero (no forma parte del objeto ni hace falta).
    const r = toneladasPorYacimientoDesdePesadas([{ fecha: "2026-08-01", origen: "D1", toneladas: 1000 }]);
    expect(r).toEqual([{ yacimientoCodigo: "D1", mes: "2026-08", toneladas: 1000 }]);
  });

  it("un origen que no es uno de los cuatro yacimientos conocidos queda afuera, no se adivina", () => {
    const r = toneladasPorYacimientoDesdePesadas([
      { fecha: "2026-08-01", origen: "PAVONE", toneladas: 100 },
      { fecha: "2026-08-01", origen: "LA ALCANCIA", toneladas: 50 },
      { fecha: "2026-08-01", origen: null, toneladas: 20 },
    ]);
    expect(r).toEqual([]);
  });
});

describe("patentesParaMostrar", () => {
  it("un fletero con un solo camión, una patente con espacio", () => {
    expect(patentesParaMostrar("Amaray")).toBe("XAG 816");
  });

  it("Schneider tiene dos camiones: las dos patentes, no sólo la primera", () => {
    expect(patentesParaMostrar("Schneider")).toBe("GBL 929 / VGC 250");
  });

  it("un nombre que no es uno de los 11 conocidos, null", () => {
    expect(patentesParaMostrar("Conte Gaston")).toBeNull();
  });
});

describe("agruparPesadasPorTipoMes", () => {
  function pesada(p: Partial<PesadaDB>): PesadaDB {
    return {
      id: "1", fecha: "2026-08-15", hora: null, bruto: null, tara: null,
      tipo: "dolomita_d1", toneladas: 10, origen: null, destino: null,
      fletero_raw: null, fletero_id: null,
      ...p,
    };
  }

  it("suma por tipo y mes sin mirar el fletero — una sin fletero resuelto también cuenta", () => {
    const r = agruparPesadasPorTipoMes([pesada({ toneladas: 10, fletero_id: "f1" }), pesada({ toneladas: 5, fletero_id: null })]);
    expect(r).toEqual([{ tipo: "dolomita_d1", mes: "2026-08-01", cantidad: 15 }]);
  });

  it("sin tipo (destape) no entra", () => {
    expect(agruparPesadasPorTipoMes([pesada({ tipo: null })])).toEqual([]);
  });
});

describe("planasDesdePesadasAgrupadas", () => {
  it("convierte filas ya agrupadas por la base (fletero+tipo+mes) al formato de AcarreoPlano", () => {
    const r = planasDesdePesadasAgrupadas([
      { fleteroId: "f1", tipo: "dolomita_d1", mes: "2026-01-01", toneladas: 15 },
    ]);
    expect(r).toEqual([{ fleteroId: "f1", tipo: "dolomita_d1", mes: "2026-01-01", cantidad: 15 }]);
  });

  it("una fila con fleteroId null (sin resolver) no entra — mismo criterio que agruparPesadasPorFleteroTipoMes", () => {
    const r = planasDesdePesadasAgrupadas([
      { fleteroId: null, tipo: "dolomita_d1", mes: "2026-01-01", toneladas: 15 },
    ]);
    expect(r).toEqual([]);
  });
});

describe("sumarPesadasAgrupadasPorTipoMes", () => {
  it("suma por tipo y mes sin mirar el fletero — incluye las de fleteroId null", () => {
    const r = sumarPesadasAgrupadasPorTipoMes([
      { fleteroId: "f1", tipo: "dolomita_d1", mes: "2026-08-01", toneladas: 10 },
      { fleteroId: null, tipo: "dolomita_d1", mes: "2026-08-01", toneladas: 5 },
      { fleteroId: "f2", tipo: "caliza", mes: "2026-08-01", toneladas: 7 },
    ]);
    expect(r).toEqual(
      expect.arrayContaining([
        { tipo: "dolomita_d1", mes: "2026-08-01", cantidad: 15 },
        { tipo: "caliza", mes: "2026-08-01", cantidad: 7 },
      ])
    );
  });
});


describe("toneladasDeOrigenesExternos", () => {
  const pesadas = [
    { fecha: "2026-08-03", tipo: "caliza", origen: "L NEGRA", toneladas: 30 },
    { fecha: "2026-08-04", tipo: "caliza", origen: "LNEGRA", toneladas: 10 },
    { fecha: "2026-08-05", tipo: "caliza", origen: "C3", toneladas: 500 },
    { fecha: "2026-08-06", tipo: "finos_caliza", origen: "L NEGRA", toneladas: 7 },
    { fecha: "2026-08-07", tipo: "material_desde_pavone", origen: "PAVONE", toneladas: 12 },
    { fecha: "2026-08-08", tipo: "material_desde_pavone", origen: "SERJEN", toneladas: 99 },
    { fecha: "2026-07-30", tipo: "caliza", origen: "L NEGRA", toneladas: 1000 },
  ];

  it("suma la caliza de Loma Negra y la piedra de Pavone del mes pedido", () => {
    expect(toneladasDeOrigenesExternos(pesadas, "2026-08")).toEqual({ calizaLomaNegra: 40, piedraPavone: 111 });
  });

  it("Pavone suma lo que dice PAVONE y lo que dice SERJEN; Loma Negra no mezcla los finos", () => {
    const r = toneladasDeOrigenesExternos(pesadas, "2026-08");
    expect(r.calizaLomaNegra).toBe(40); // sin los 7 de finos
    expect(r.piedraPavone).toBe(12 + 99);
  });

  it("un mes sin nada da ceros", () => {
    expect(toneladasDeOrigenesExternos(pesadas, "2026-09")).toEqual({ calizaLomaNegra: 0, piedraPavone: 0 });
  });
});

describe("dolomita D1 de PT 2 cuenta como acarreo de D1 (Cubicación)", () => {
  const pesadas = [
    { fecha: "2026-08-03", tipo: "dolomita_d1", origen: "PT 2", toneladas: 30 },
    { fecha: "2026-08-09", tipo: "dolomita_d1", origen: "P T 2", toneladas: 20 },
    { fecha: "2026-09-01", tipo: "dolomita_d1", origen: "PT 2", toneladas: 5 },
    { fecha: "2026-08-04", tipo: "dolomita_d6", origen: "PT 2", toneladas: 33 }, // D6: no es de D1
    { fecha: "2026-08-05", tipo: "dolomita_d1", origen: "D1", toneladas: 999 }, // ya lo cuenta la función SQL
  ];

  it("suma por mes, con PT 2 y P T 2 juntos, sólo de dolomita D1", () => {
    expect(toneladasDolomitaD1DePlanta2PorMes(pesadas)).toEqual([
      { yacimientoCodigo: "D1", mes: "2026-08", toneladas: 50 },
      { yacimientoCodigo: "D1", mes: "2026-09", toneladas: 5 },
    ]);
  });

  it("se suma al acarreo de D1 que ya había, mes a mes, sin tocar los otros yacimientos", () => {
    const r = sumarAcarreosPorYacimiento(
      [{ yacimientoCodigo: "D1", mes: "2026-08", toneladas: 1000 }, { yacimientoCodigo: "D6", mes: "2026-08", toneladas: 400 }],
      toneladasDolomitaD1DePlanta2PorMes(pesadas)
    );
    expect(r.find((a) => a.yacimientoCodigo === "D1" && a.mes === "2026-08")!.toneladas).toBe(1050);
    expect(r.find((a) => a.yacimientoCodigo === "D6")!.toneladas).toBe(400);
    expect(r.find((a) => a.yacimientoCodigo === "D1" && a.mes === "2026-09")!.toneladas).toBe(5);
  });
});
