import { describe, expect, it } from "vitest";
import { interpretarExcel, TOPE_DE_HORAS_POR_FILA, type CeldaDelExcel, type FilaDelExcel } from "./cuadernoExcel";

/**
 * Las filas se escriben a mano, sin armar ningún `.xlsx`: es lo que permite
 * probar cada decisión por separado. Abrir el archivo de verdad se prueba en
 * `cuadernoExcelArchivo.test.ts`.
 */

/** El encabezado del archivo real: `Tarea · Fecha Desde · Fecha Hasta · Hs · Precio ($)`. */
const ENCABEZADO: FilaDelExcel = {
  fila: 1,
  celdas: { A: "Tarea", B: "Fecha Desde", C: "Fecha Hasta", D: "Hs", E: "Precio ($)" },
};

function fila(n: number, celdas: Record<string, CeldaDelExcel>): FilaDelExcel {
  return { fila: n, celdas };
}

/** Una fila de tarea con las columnas del archivo real. */
function tarea(
  n: number,
  valores: { tarea?: CeldaDelExcel; desde?: CeldaDelExcel; hasta?: CeldaDelExcel; hs?: CeldaDelExcel; precio?: CeldaDelExcel }
): FilaDelExcel {
  const celdas: Record<string, CeldaDelExcel> = {};
  if (valores.tarea !== undefined) celdas.A = valores.tarea;
  if (valores.desde !== undefined) celdas.B = valores.desde;
  if (valores.hasta !== undefined) celdas.C = valores.hasta;
  if (valores.hs !== undefined) celdas.D = valores.hs;
  if (valores.precio !== undefined) celdas.E = valores.precio;
  return fila(n, celdas);
}

/** Lee y se queda con el caso bueno, que es el que casi todos los tests miran. */
function leer(filas: FilaDelExcel[]) {
  const r = interpretarExcel(filas);
  if (!r.ok) throw new Error(`no se reconoció: ${r.error}`);
  return r;
}

describe("el encabezado dice qué columna es cada cosa", () => {
  it("las cinco columnas del archivo real", () => {
    expect(leer([ENCABEZADO, tarea(2, { tarea: "Alambrado DG", hs: 60 })]).columnas).toEqual({
      tarea: "A", desde: "B", hasta: "C", horas: "D", precio: "E",
    });
  });

  it("no importa en qué columna estén: el encabezado es el contrato", () => {
    // Era `K` a `O` cuando la tabla vivía a la derecha de un detalle.
    const enK = fila(1, { K: "Tarea", L: "Fecha Desde", M: "Fecha Hasta", N: "Hs", O: "Precio ($)" });
    const r = leer([enK, fila(2, { K: "Alambrado DG", L: "16/10/2026", N: 60 })]);

    expect(r.columnas).toEqual({ tarea: "K", desde: "L", hasta: "M", horas: "N", precio: "O" });
    expect(r.renglones[0].tarea).toBe("Alambrado DG");
    expect(r.renglones[0].horas).toBe(60);
  });

  it("no importa el orden de las columnas", () => {
    const alReves = fila(1, { A: "Hs", B: "Precio ($)", C: "Tarea", D: "Fecha Desde" });
    expect(leer([alReves, fila(2, { A: 8, C: "Tranqueras", D: "06/10/2026" })]).columnas).toEqual({
      tarea: "C", desde: "D", hasta: null, horas: "A", precio: "B",
    });
  });

  it("acepta los nombres cortos y «Horas» y «Descripción»", () => {
    const otros = fila(1, { A: "Descripción", B: "Desde", C: "Hasta", D: "Horas", E: "Importe" });
    expect(leer([otros, fila(2, { A: "x", D: 1 })]).columnas).toEqual({
      tarea: "A", desde: "B", hasta: "C", horas: "D", precio: "E",
    });
  });

  it("ignora acentos y mayúsculas", () => {
    const gritado = fila(1, { A: "TAREA", B: "FECHA DESDE", C: "FECHA HASTA", D: "HS" });
    expect(leer([gritado, fila(2, { A: "x", D: 1 })]).columnas.tarea).toBe("A");
  });

  it("una sola columna «Fecha» es el día en que empieza, y el rango se colapsa", () => {
    const una = fila(1, { A: "Tarea", B: "Fecha", C: "Hs" });
    const r = leer([una, fila(2, { A: "Limpieza", B: "06/10/2026", C: 4 })]);

    expect(r.columnas.desde).toBe("B");
    expect(r.columnas.hasta).toBeNull();
    expect(r.renglones[0]).toMatchObject({ desde: "2026-10-06", hasta: "2026-10-06", dudoso: false });
  });

  it("un título arriba no molesta: el encabezado se busca en las primeras filas", () => {
    const r = leer([
      fila(1, { A: "Tareas de Octubre 2026" }),
      fila(2, {}),
      { ...ENCABEZADO, fila: 3 },
      tarea(4, { tarea: "Alambrado DG", desde: "16/10/2026", hs: 60 }),
    ]);

    // Las filas siguen siendo las del Excel, no se renumeran.
    expect(r.renglones.map((x) => x.fila)).toEqual([4]);
  });

  it("un encabezado más abajo que las primeras diez filas no cuenta", () => {
    const r = interpretarExcel([{ ...ENCABEZADO, fila: 11 }, tarea(12, { tarea: "x", hs: 1 })]);
    expect(r.ok).toBe(false);
  });

  it("sin «Tarea» y «Hs» no se reconoce, y se dice qué había", () => {
    const r = interpretarExcel([fila(1, { A: "Lugar", B: "Cantidad" }), fila(2, { A: "x", B: 1 })]);

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("«Tarea»");
      expect(r.error).toContain("«Lugar»");
      expect(r.error).toContain("«Cantidad»");
    }
  });

  it("un archivo vacío no se reconoce", () => {
    const r = interpretarExcel([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("no tiene ninguna fila");
  });

  it("falta la columna de fecha: se carga igual y se avisa que no se va a poder generar", () => {
    const sinFecha = fila(1, { A: "Tarea", B: "Hs" });
    const r = leer([sinFecha, fila(2, { A: "Alambrado", B: 60 })]);

    expect(r.renglones[0]).toMatchObject({ desde: null, hasta: null, horas: 60, dudoso: false });
    expect(r.problemas.join(" ")).toContain("ninguna columna de fecha");
  });

  it("falta la columna de precio: se avisa, y las órdenes salen sólo con horas", () => {
    const sinPrecio = fila(1, { A: "Tarea", B: "Fecha Desde", C: "Hs" });
    const r = leer([sinPrecio, fila(2, { A: "Alambrado", B: "16/10/2026", C: 60 })]);

    expect(r.columnas.precio).toBeNull();
    expect(r.renglones[0].costo).toBeNull();
    expect(r.problemas.join(" ")).toContain("columna de precio");
  });
});

describe("cada fila es una tarea, y una tarea es una orden", () => {
  it("trae tarea, las dos fechas, horas y la fila del Excel", () => {
    const r = leer([ENCABEZADO, tarea(2, {
      tarea: "Alambrado DG", desde: "16/10/2026", hasta: "18/10/2026", hs: 60,
    })]);

    expect(r.renglones).toEqual([{
      fila: 2, tarea: "Alambrado DG", desde: "2026-10-16", hasta: "2026-10-18",
      horas: 60, costo: null, dudoso: false, motivo_dudoso: null,
    }]);
  });

  it("la tarea se recorta y nada más", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "  Colocar bomba gasolera en cantera  ", desde: "06/10/2026", hs: 8 })]);
    expect(r.renglones[0].tarea).toBe("Colocar bomba gasolera en cantera");
  });

  it("una fila en blanco en el medio se saltea sin decir nada", () => {
    const r = leer([
      ENCABEZADO,
      tarea(2, { tarea: "Alambrado DG", desde: "16/10/2026", hs: 60 }),
      fila(3, {}),
      tarea(4, { tarea: "Tranqueras DG", desde: "06/10/2026", hs: 84 }),
    ]);

    expect(r.renglones.map((x) => x.fila)).toEqual([2, 4]);
    expect(r.problemas.join(" ")).not.toContain("fila 3");
  });

  it("una fila con horas y sin tarea no se carga, y se dice con su número de fila", () => {
    const r = leer([ENCABEZADO, tarea(2, { desde: "16/10/2026", hs: 60 })]);

    expect(r.renglones).toEqual([]);
    expect(r.problemas.join(" ")).toContain("La fila 2 tiene datos pero no dice qué tarea es");
  });

  it("un precio sin horas es una orden por trabajo, no un dudoso", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "1 empalme cinta 5", desde: "06/10/2026", precio: 920000 })]);
    expect(r.renglones[0]).toMatchObject({ horas: null, costo: 920000, dudoso: false });
  });

  it("un precio escrito como texto se lee con la regla del dinero: el punto es de miles", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "Empalme", desde: "06/10/2026", precio: "$ 920.000" })]);
    expect(r.renglones[0].costo).toBe(920000);
  });

  it("las horas escritas como texto se leen con la regla de las horas: la coma es decimal", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "Limpieza", desde: "06/10/2026", hs: "4,5" })]);
    expect(r.renglones[0]).toMatchObject({ horas: 4.5, dudoso: false });
  });

  it("unas horas que no son un número entran dudosas, con lo que decía", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "Limpieza", desde: "06/10/2026", hs: "varias" })]);

    expect(r.renglones[0]).toMatchObject({ horas: null, dudoso: true });
    expect(r.renglones[0].motivo_dudoso).toContain("«varias»");
  });

  it("unas horas negativas no se toman y la fila entra dudosa", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "Limpieza", desde: "06/10/2026", hs: -4 })]);

    expect(r.renglones[0]).toMatchObject({ horas: null, dudoso: true });
    expect(r.renglones[0].motivo_dudoso).toContain("negativas");
  });

  it("una fila sin horas ni precio entra dudosa", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "Alambrado DG", desde: "16/10/2026" })]);

    expect(r.renglones[0]).toMatchObject({ horas: null, costo: null, dudoso: true });
    expect(r.renglones[0].motivo_dudoso).toContain("ni horas ni precio");
  });

  it("más horas que el tope por fila entra dudoso, con el número intacto", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "Alambrado", desde: "16/10/2026", hs: TOPE_DE_HORAS_POR_FILA + 1 })]);

    expect(r.renglones[0].horas).toBe(TOPE_DE_HORAS_POR_FILA + 1);
    expect(r.renglones[0].dudoso).toBe(true);
    expect(r.renglones[0].motivo_dudoso).toContain("revisalo");
  });

  it("justo en el tope no es dudoso", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "Alambrado", desde: "16/10/2026", hs: TOPE_DE_HORAS_POR_FILA })]);
    expect(r.renglones[0].dudoso).toBe(false);
  });

  it("una fórmula en las horas se lee por su valor calculado", () => {
    const r = leer([ENCABEZADO, tarea(2, {
      tarea: "Alambrado", desde: "16/10/2026", hs: { formula: "20*3", resultado: 60 },
    })]);
    expect(r.renglones[0]).toMatchObject({ horas: 60, dudoso: false });
  });

  it("una fórmula sin valor calculado entra dudosa: el archivo no lo guardó Excel", () => {
    const r = leer([ENCABEZADO, tarea(2, {
      tarea: "Alambrado", desde: "16/10/2026", hs: { formula: "20*3" },
    })]);

    expect(r.renglones[0]).toMatchObject({ horas: null, dudoso: true });
    expect(r.renglones[0].motivo_dudoso).toContain("sin valor calculado");
  });

  it("un error de celda en las horas entra dudoso y dice cuál", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "Alambrado", desde: "16/10/2026", hs: { error: "#VALUE!" } })]);

    expect(r.renglones[0]).toMatchObject({ horas: null, dudoso: true });
    expect(r.renglones[0].motivo_dudoso).toContain("#VALUE!");
  });
});

describe("las fechas", () => {
  it("el texto es día/mes/año, nunca mes/día", () => {
    // 06/10 es el 6 de octubre. Leerlo al revés dio vuelta 885 fechas en Compras.
    const r = leer([ENCABEZADO, tarea(2, { tarea: "x", desde: "06/10/2026", hasta: "23/10/2026", hs: 84 })]);
    expect(r.renglones[0]).toMatchObject({ desde: "2026-10-06", hasta: "2026-10-23" });
  });

  it("un Date de Excel se lee por su día UTC, sin correrse por el huso", () => {
    const r = leer([ENCABEZADO, tarea(2, {
      tarea: "x", desde: new Date("2026-10-01T00:00:00Z"), hs: 4,
    })]);
    expect(r.renglones[0].desde).toBe("2026-10-01");
  });

  it("un ISO con hora es el mismo día y no el de adelante", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "x", desde: "2026-10-06T00:00:00.000Z", hs: 8 })]);
    expect(r.renglones[0].desde).toBe("2026-10-06");
  });

  it("un número de serie de Excel es una fecha", () => {
    // 46296 es el 1 de octubre de 2026: la serie cuenta días desde 1899-12-30.
    const r = leer([ENCABEZADO, tarea(2, { tarea: "x", desde: 46296, hs: 8 })]);
    expect(r.renglones[0].desde).toBe("2026-10-01");
  });

  it("sólo «desde»: la tarea fue de un día y el rango se colapsa, sin marcar nada", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "x", desde: "06/10/2026", hs: 8 })]);
    expect(r.renglones[0]).toMatchObject({ desde: "2026-10-06", hasta: "2026-10-06", dudoso: false });
  });

  it("sólo «hasta»: se usa para las dos puntas y no se inventa un principio", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "x", hasta: "06/10/2026", hs: 8 })]);
    expect(r.renglones[0]).toMatchObject({ desde: "2026-10-06", hasta: "2026-10-06", dudoso: false });
  });

  it("un #REF! en la fecha desde entra dudoso y la otra punta se usa igual", () => {
    // Es la fila 24 del archivo real de octubre: una referencia que quedó rota
    // al sacar el detalle. La tarea no se pierde por eso.
    const r = leer([ENCABEZADO, tarea(24, {
      tarea: "Colocar bomba gasolera en cantera ",
      desde: { formula: "#REF!", resultado: { error: "#REF!" } },
      hasta: "2026-10-06T00:00:00.000Z",
      hs: 8,
    })]);

    expect(r.renglones[0]).toMatchObject({
      fila: 24, tarea: "Colocar bomba gasolera en cantera", desde: "2026-10-06", hasta: "2026-10-06", horas: 8, dudoso: true,
    });
    expect(r.renglones[0].motivo_dudoso).toContain("#REF!");
  });

  it("un día que no existe queda en null, dudoso, y con lo que decía", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "x", desde: "31/02/2026", hs: 8 })]);

    expect(r.renglones[0]).toMatchObject({ desde: null, hasta: null, dudoso: true });
    expect(r.renglones[0].motivo_dudoso).toContain("«31/02/2026»");
  });

  it("un año fuera de rango no entra, y lo dice", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "x", desde: "06/10/1926", hs: 8 })]);

    expect(r.renglones[0].desde).toBeNull();
    expect(r.renglones[0].motivo_dudoso).toContain("1926");
  });

  it("sin ninguna de las dos fechas, habiendo columnas, entra dudoso", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "x", hs: 8 })]);

    expect(r.renglones[0]).toMatchObject({ desde: null, hasta: null, dudoso: true });
    expect(r.renglones[0].motivo_dudoso).toContain("No trae ninguna fecha");
  });

  it("la fecha hasta anterior a la desde entra dudosa, y las dos se conservan", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "x", desde: "23/10/2026", hasta: "06/10/2026", hs: 8 })]);

    expect(r.renglones[0]).toMatchObject({ desde: "2026-10-23", hasta: "2026-10-06", dudoso: true });
    expect(r.renglones[0].motivo_dudoso).toContain("anterior");
  });
});

describe("el control: la suma de las filas tiene que dar el total declarado", () => {
  it("cuando cierra, la cuenta lo dice y no hay problemas", () => {
    const r = leer([
      ENCABEZADO,
      tarea(2, { tarea: "Alambrado DG", desde: "16/10/2026", hs: 60 }),
      tarea(3, { tarea: "Tranqueras DG", desde: "06/10/2026", hs: 84 }),
      tarea(4, { tarea: "TOTALES", hs: 144 }),
    ]);

    expect(r.control).toMatchObject({ hay_total: true, cierra: true, horas_filas: 144, horas_total: 144, diferencia: 0 });
    expect(r.problemas).toEqual([]);
    expect(r.renglones).toHaveLength(2);
  });

  it("la fila de TOTALES no es una tarea", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "Alambrado", hs: 60 }), tarea(3, { tarea: "Totales", hs: 60 })]);
    expect(r.renglones.map((x) => x.tarea)).toEqual(["Alambrado"]);
  });

  it("si no da, los renglones entran igual y se dice de cuánto es la diferencia", () => {
    const r = leer([
      ENCABEZADO,
      tarea(2, { tarea: "Alambrado DG", desde: "16/10/2026", hs: 60 }),
      tarea(3, { tarea: "TOTALES", hs: 1074 }),
    ]);

    expect(r.renglones).toHaveLength(1);
    expect(r.control).toMatchObject({ cierra: false, horas_filas: 60, horas_total: 1074, diferencia: 1014 });
    expect(r.problemas[0]).toContain("faltan 1014 h");
    expect(r.problemas[0]).toContain("fila 3");
    expect(r.problemas[0]).toContain("se cargaron igual");
  });

  it("si el total declara de menos, lo dice al revés", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "x", hs: 100 }), tarea(3, { tarea: "TOTALES", hs: 60 })]);
    expect(r.problemas[0]).toContain("sobran 40 h");
  });

  it("sin fila de TOTALES se carga, y se avisa que no hay contra qué comparar", () => {
    const r = leer([ENCABEZADO, tarea(2, { tarea: "Alambrado DG", desde: "16/10/2026", hs: 60 })]);

    expect(r.control).toMatchObject({ hay_total: false, cierra: true, horas_total: null });
    expect(r.problemas.join(" ")).toContain("no trae fila de TOTALES");
    expect(r.problemas.join(" ")).toContain("60 h");
  });

  it("las horas fraccionarias no rompen la cuenta por redondeo", () => {
    const r = leer([
      ENCABEZADO,
      tarea(2, { tarea: "a", hs: 5.33 }),
      tarea(3, { tarea: "b", hs: 5.33 }),
      tarea(4, { tarea: "c", hs: 5.34 }),
      tarea(5, { tarea: "TOTALES", hs: 16 }),
    ]);
    expect(r.control.cierra).toBe(true);
  });

  it("un TOTALES cuyas horas no se pueden leer se dice, y no frena la carga", () => {
    const r = leer([
      ENCABEZADO,
      tarea(2, { tarea: "Alambrado", hs: 60 }),
      tarea(3, { tarea: "TOTALES", hs: { error: "#REF!" } }),
    ]);

    expect(r.renglones).toHaveLength(1);
    expect(r.control.hay_total).toBe(false);
    expect(r.problemas.join(" ")).toContain("#REF!");
  });

  it("el costo se suma aparte y no entra en el control de horas", () => {
    const r = leer([
      ENCABEZADO,
      tarea(2, { tarea: "Empalme", precio: 920000 }),
      tarea(3, { tarea: "Parche", precio: "80.000" }),
      tarea(4, { tarea: "TOTALES", hs: 0 }),
    ]);

    expect(r.control.costo_filas).toBe(1000000);
    expect(r.control.cierra).toBe(true);
  });

  it("informa todos los problemas juntos y no de a uno", () => {
    const sinPrecio = fila(1, { A: "Tarea", B: "Hs" });
    const r = leer([sinPrecio, fila(2, { B: 60 }), fila(3, { A: "TOTALES", B: 999 })]);

    expect(r.problemas.length).toBeGreaterThanOrEqual(3);
    const todo = r.problemas.join(" ");
    expect(todo).toContain("no dice qué tarea es");
    expect(todo).toContain("ninguna columna de fecha");
    expect(todo).toContain("columna de precio");
  });

  it("lo primero que se dice es lo que no cierra, y después lo que falta", () => {
    const r = leer([
      fila(1, { A: "Tarea", B: "Hs" }),
      fila(2, { A: "Alambrado", B: 60 }),
      fila(3, { A: "TOTALES", B: 100 }),
    ]);
    expect(r.problemas[0]).toContain("no dan el total declarado");
  });
});
