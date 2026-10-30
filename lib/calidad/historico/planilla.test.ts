import { describe, it, expect } from "vitest";
import {
  esAgregacion, mallaDeLaEtiqueta, unidadDeLaEtiqueta,
  filasDeHojaTabular, filasDeHojaEnBloques, revisarAritmetica,
} from "./planilla";
import type { FilaHistorica } from "./types";

describe("esAgregacion", () => {
  it("reconoce un promedio por su formula, no por su valor", () => {
    // El libro tiene 22, todas en `Calcio`, metidas entre las muestras. Un
    // promedio guardado como medición es el error que todo esto evita.
    expect(esAgregacion({ valor: 0.0068, formula: "AVERAGE(C2:C4)" })).toBe(true);
    expect(esAgregacion({ valor: 12, formula: "SUM(A1:A3)" })).toBe(true);
    expect(esAgregacion({ valor: 0.0068 })).toBe(false);
    expect(esAgregacion({ valor: 0.07, formula: "0.007+0.065" })).toBe(false);
  });
});

describe("mallaDeLaEtiqueta y unidadDeLaEtiqueta", () => {
  it("despeja la malla del texto", () => {
    expect(mallaDeLaEtiqueta("Acumulado en #200 (%)")).toBe(200);
    expect(mallaDeLaEtiqueta("Ret #50 (%)")).toBe(50);
    expect(mallaDeLaEtiqueta("Humedad bh (%)")).toBeNull();
  });

  it("despeja la unidad", () => {
    expect(unidadDeLaEtiqueta("Peso volumétrico (g/l)")).toBe("g/l");
    expect(unidadDeLaEtiqueta("Ret #50 (%)")).toBe("%");
    expect(unidadDeLaEtiqueta("Cal (Ton)")).toBe("Ton");
    expect(unidadDeLaEtiqueta("Muestra")).toBeNull();
  });
});

describe("filasDeHojaTabular", () => {
  // Datos reales de Filler 1 alrededor del corte.
  const ENC = ["Fecha", "Ret #50 (%)", "Ret #100 (%)", "Ret #200 (%)", "Acumulado #200 (%)"];
  const ANTES = [{ valor: "2026-05-04" }, {}, { valor: 0.049 }, {}, { valor: 0.269 }];
  const DESPUES = [
    { valor: "2026-06-02" }, { valor: 0 }, { valor: 4.3 }, { valor: 19.3 }, { valor: 23.6 },
  ];

  it("etiqueta cada valor con la escala de su columna y su fecha", () => {
    const r = filasDeHojaTabular("Filler 1", ENC, [ANTES, DESPUES]);
    expect(r.find((f) => f.fecha === "2026-05-04")!.escala).toBe("fraccion");
    expect(
      r.find((f) => f.fecha === "2026-06-02" && f.malla === 200 && /Acum/.test(f.determinacion))!
        .escala
    ).toBe("porcentaje");
  });

  it("Ret #200 nacio con la planilla nueva: nunca es fraccion", () => {
    // Si se la tratara como fracción, 19,3 pasaría a 1930.
    const r = filasDeHojaTabular("Filler 1", ENC, [ANTES, DESPUES]);
    const ret200 = r.filter((f) => f.determinacion === "Ret #200 (%)");
    expect(ret200.length).toBeGreaterThan(0);
    expect(ret200.every((f) => f.escala === "porcentaje")).toBe(true);
  });

  it("no toca el valor: guarda 0,269 y no 26,9", () => {
    const r = filasDeHojaTabular("Filler 1", ENC, [ANTES, DESPUES]);
    expect(r.find((f) => f.fecha === "2026-05-04" && /Acum/.test(f.determinacion))!.valor).toBe(0.269);
  });

  it("descarta la celda de agregacion", () => {
    const conPromedio = [{ valor: "2026-06-03" }, {}, { valor: 3.2, formula: "AVERAGE(C2:C4)" }, {}, {}];
    expect(filasDeHojaTabular("Filler 1", ENC, [conPromedio])).toHaveLength(0);
  });

  it("saltea la fila sin fecha", () => {
    expect(
      filasDeHojaTabular("Filler 1", ENC, [[{ valor: "" }, {}, { valor: 1 }, {}, {}]])
    ).toHaveLength(0);
  });

  it("numera la fila como la ve la planilla, con el encabezado en la 1", () => {
    const r = filasDeHojaTabular("Filler 1", ENC, [ANTES, DESPUES]);
    expect(r.find((f) => f.fecha === "2026-05-04")!.fila_excel).toBe(2);
    expect(r.find((f) => f.fecha === "2026-06-02")!.fila_excel).toBe(3);
  });

  it("una fila de Despachos cal fillerizada sin cliente no genera filas", () => {
    // El cliente es el origen_raw de esa hoja, y es not null. Sin él, el valor
    // no se puede colgar de nada: se pierde, que es mejor que inventarle dueño.
    const enc = ["Fecha", "Cliente", "Cal (Ton)"];
    const sinCliente = [{ valor: "2026-07-08" }, { valor: "" }, { valor: 12 }];
    expect(filasDeHojaTabular("Despachos cal fillerizada", enc, [sinCliente])).toHaveLength(0);
  });

  it("en Despachos cal fillerizada el origen es el cliente, no la hoja", () => {
    const enc = ["Fecha", "Cliente", "Cal (Ton)"];
    const fila = [{ valor: "2026-07-08" }, { valor: "Marcalba" }, { valor: 12 }];
    const r = filasDeHojaTabular("Despachos cal fillerizada", enc, [fila]);
    expect(r[0]).toMatchObject({ origen_raw: "Marcalba", determinacion: "Cal (Ton)", valor: 12 });
  });

  it("en las cinco tabulares el origen es la hoja", () => {
    const r = filasDeHojaTabular("Filler 1", ENC, [DESPUES]);
    expect(r[0].origen_raw).toBe("Filler 1");
  });
});

describe("filasDeHojaTabular: la tabla de al lado", () => {
  // Datos reales de `Calcio`. A la derecha de su tabla hay OTRA tabla: tres
  // granulometrías, cada una con su fecha en la fila 1 y su propio encabezado
  // dos filas más abajo. El parseo tabular leía esa fecha como si fuera el
  // nombre de una determinación, así que un número de tamiz —4, 10, 18—
  // entraba como medición, con la fecha y la muestra de la fila de la
  // izquierda, que son de otro análisis.
  const ENC = [
    "Fecha", "Muestra", "Humedad bh (%)", "P recipiente (g)", "", "", "",
    "2026-07-31", "2026-08-28",
  ];
  const FILA = [
    { valor: "2026-07-28" }, { valor: "Caliza galpón" }, { valor: 0.0086 },
    { valor: 433.25 }, {}, {}, {}, { valor: 4 }, { valor: 0 },
  ];

  it("una columna cuyo encabezado es una fecha no es una determinación", () => {
    const r = filasDeHojaTabular("Calcio", ENC, [FILA]);
    expect(r.map((f) => f.determinacion).sort()).toEqual([
      "Humedad bh (%)", "P recipiente (g)",
    ]);
  });
});

describe("filasDeHojaEnBloques", () => {
  // El bloque de ejemplo del spec, tal cual.
  const BLOQUE = [
    [{ valor: "2026-06-17" }, { valor: "Calcio 0-1" }, { valor: "Calcio 0-2" }],
    [{ valor: "Humedad bh (%)" }, { valor: 0.0068 }, { valor: 0.0087 }],
    [{ valor: "P recipiente" }, { valor: 426.68 }, { valor: 433.22 }],
  ];

  it("usa la fecha de la fila que la trae y los nombres de muestra de su derecha", () => {
    const r = filasDeHojaEnBloques("Otros", BLOQUE);
    expect(r).toHaveLength(4);
    expect(r[0]).toMatchObject({
      fecha: "2026-06-17",
      origen_raw: "Calcio 0-1",
      determinacion: "Humedad bh (%)",
      valor: 0.0068,
      escala: "fraccion",
    });
  });

  it("cierra el bloque en la siguiente fila con fecha", () => {
    const dos = [
      ...BLOQUE,
      [{ valor: "2026-07-02" }, { valor: "Caliza Galpones" }],
      [{ valor: "P final" }, { valor: 533.45 }],
    ];
    const r = filasDeHojaEnBloques("Otros", dos);
    expect(r.find((f) => f.determinacion === "P final")!.origen_raw).toBe("Caliza Galpones");
  });

  it("sin nombre de muestra no genera fila", () => {
    // `origen_raw` es not null: inventar "col 3" sería un origen que no existe.
    const sinNombre = [
      [{ valor: "2026-06-17" }, { valor: "" }],
      [{ valor: "Humedad bh (%)" }, { valor: 0.0068 }],
    ];
    expect(filasDeHojaEnBloques("Otros", sinNombre)).toHaveLength(0);
  });

  it("toma los nombres de la fila siguiente cuando la fecha va sola", () => {
    // Pasa dos veces en `Otros`: la fila 13 es sólo la fecha y la 14 trae los
    // nombres. Leerlo mal pierde 66 valores, entre ellos la granulometria
    // completa de seis productos.
    const nombresAbajo = [
      [{ valor: "2026-10-02" }],
      [{ valor: "Tamiz" }, { valor: "Calcio 0-2" }, { valor: "Dolomita 0-2" }],
      [{ valor: "#50" }, { valor: 3.8 }, { valor: 2.3 }],
    ];
    const r = filasDeHojaEnBloques("Otros", nombresAbajo);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ origen_raw: "Calcio 0-2", determinacion: "#50", valor: 3.8 });
  });

  it("una fecha no es un nombre de muestra", () => {
    // `Separadoras` fila 2 tiene una fecha en un casillero de nombre. Sin esto
    // queda un origen llamado "2026-06-24" y, debajo, un 50 de malla leido como
    // humedad en fraccion: la pantalla imprime 5000%.
    const conFecha = [
      [{ valor: "2026-06-22" }, { valor: "Cal falla" }, { valor: "2026-06-24" }],
      [{ valor: "Humedad bh (%)" }, { valor: 0.0026 }, { valor: 50 }],
    ];
    const r = filasDeHojaEnBloques("Separadoras", conFecha);
    expect(r.map((f) => f.origen_raw)).toEqual(["Cal falla"]);
  });

  it("respeta el porcentaje de la etiqueta en vez de forzar absoluto", () => {
    const r = filasDeHojaEnBloques("Separadoras", [
      [{ valor: "2026-06-25" }, { valor: "Retorno" }],
      [{ valor: "Ret #50 (%)" }, { valor: 6.4 }],
    ]);
    expect(r[0]).toMatchObject({ escala: "porcentaje", unidad: "%", malla: 50 });
  });

  it("ignora la celda sin valor numerico", () => {
    const conHueco = [
      [{ valor: "2026-06-17" }, { valor: "Calcio 0-1" }],
      [{ valor: "Humedad bh (%)" }, { valor: "-" }],
    ];
    expect(filasDeHojaEnBloques("Otros", conHueco)).toHaveLength(0);
  });

  it("descarta la agregacion tambien en los bloques", () => {
    const conPromedio = [
      [{ valor: "2026-06-17" }, { valor: "Calcio 0-1" }],
      [{ valor: "Humedad bh (%)" }, { valor: 0.0068, formula: "AVERAGE(C2:C4)" }],
    ];
    expect(filasDeHojaEnBloques("Calcio", conPromedio)).toHaveLength(0);
  });
});

describe("revisarAritmetica", () => {
  const filaEscalada = (vals: Record<string, [number, "fraccion" | "porcentaje"]>): FilaHistorica[] =>
    Object.entries(vals).map(([k, [valor, escala]]) => {
      const malla = Number(k.replace(/\D/g, ""));
      const acum = k.startsWith("acum");
      return {
        fecha: "2026-03-02", hoja: "Filler 1", origen_raw: "Filler 1",
        determinacion: `${acum ? "Acumulado" : "Ret"} #${malla} (%)`,
        malla, valor, escala, unidad: "%", revisar: null, fila_excel: 2,
      };
    });

  const fila = (vals: Record<string, number>): FilaHistorica[] =>
    Object.entries(vals).map(([k, valor]) => {
      const malla = Number(k.replace(/\D/g, ""));
      const acum = k.startsWith("acum");
      return {
        fecha: "2026-09-07", hoja: "Filler 1", origen_raw: "Filler 1",
        determinacion: `${acum ? "Acumulado" : "Ret"} #${malla} (%)`,
        malla, valor, escala: "porcentaje" as const, unidad: "%",
        revisar: null, fila_excel: 2,
      };
    });

  it("no dice nada cuando la fila no tiene con que comprobarse", () => {
    // `Cal` tiene 204 filas con acumulado y ningún retenido. Sin dos retenidos
    // no hay nada que comparar, y eso no es un hallazgo: serían 204 falsos.
    expect(revisarAritmetica(fila({ acum200: 5.8 }))).toBeNull();
    expect(revisarAritmetica(fila({ ret200: 4.2, acum200: 5.8 }))).toBeNull();
  });

  it("marca la fila cuyo acumulado no da la suma de sus retenidos", () => {
    // Caso real de Filler 1, 2026-09-07: acum200=21,9 y los retenidos suman 22,9.
    expect(revisarAritmetica(fila({ ret50: 0.8, ret100: 2.8, ret200: 19.3, acum200: 21.9 })))
      .toMatch(/acumulado/i);
  });

  it("no compara valores de escalas distintas", () => {
    // Entre febrero y mayo de 2026 Ret #200 ya iba en porcentaje y el acumulado
    // seguia en fraccion. Comparar 0,113 contra 60 no dice nada: no es una
    // inconsistencia de la planilla, es que no son la misma unidad.
    expect(revisarAritmetica(filaEscalada({
      ret100: [0.05, "fraccion"], ret200: [60, "porcentaje"], acum200: [0.113, "fraccion"],
    }))).toBeNull();
  });

  it("no marca la que cierra dentro de la tolerancia de 0,15", () => {
    // 4,3 + 19,3 = 23,6, que es lo que dice el acumulado.
    expect(revisarAritmetica(fila({ ret100: 4.3, ret200: 19.3, acum200: 23.6 }))).toBeNull();
  });
});

describe("desambiguarPorAritmetica", () => {
  // `Ret #50` de Kartonsec: todos sus valores son menores a 1, asi que la regla
  // por columna lo llama fraccion. Pero sus hermanos de la misma fila son
  // porcentajes claros, y la suma solo cierra si tambien lo es.
  const ENC = ["Fecha", "Ret #50 (%)", "Ret #100 (%)", "Ret #200(%)", "Acumulado en #200 (%)"];
  const FILAS = [
    [{ valor: "2026-06-02" }, { valor: 0.8 }, { valor: 5.5 }, { valor: 22.7 }, { valor: 29.0 }],
    [{ valor: "2026-06-03" }, { valor: 0.4 }, { valor: 5.4 }, { valor: 20.3 }, { valor: 26.1 }],
  ];

  it("lee como porcentaje la columna chica cuya suma solo cierra asi", () => {
    const r = filasDeHojaTabular("Despacho a Kartonsec", ENC, FILAS);
    const ret50 = r.filter((f) => f.determinacion === "Ret #50 (%)");
    expect(ret50).toHaveLength(2);
    expect(ret50.every((f) => f.escala === "porcentaje")).toBe(true);
  });

  it("y entonces la fila cierra y no queda marcada", () => {
    const r = filasDeHojaTabular("Despacho a Kartonsec", ENC, FILAS);
    const deLaPrimera = r.filter((f) => f.fecha === "2026-06-02");
    expect(revisarAritmetica(deLaPrimera)).toBeNull();
  });

  it("no toca la columna chica cuando la aritmetica no puede decir nada", () => {
    // Sin acumulado contra el cual probar, la regla por columna se respeta.
    const sinAcum = [[{ valor: "2026-06-02" }, { valor: 0.8 }, { valor: 0.5 }]];
    const r = filasDeHojaTabular("Despacho a Kartonsec", ["Fecha", "Ret #50 (%)", "Ret #100 (%)"], sinAcum);
    expect(r.every((f) => f.escala === "fraccion")).toBe(true);
  });
});
