import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { filasDeLaHoja, interpretarArchivo } from "./cuadernoExcelArchivo";

/**
 * Lo que prueba este archivo es lo que no se puede probar sin un `.xlsx`: que
 * lo que `exceljs` devuelve llegue al intérprete **sin perder la diferencia
 * entre un número y una celda rota**. Un `#REF!` aplanado a `null` se ve igual
 * que una celda vacía, y entonces una fecha rota entraría como «no trae fecha»
 * en vez de «referencia rota»: el renglón se cargaría sin que nadie supiera que
 * hay algo que arreglar en la planilla.
 *
 * Las decisiones —qué columna es cada cosa, qué es un total, si la suma da—
 * están probadas en `cuadernoExcel.test.ts` sobre filas escritas a mano.
 */

/** Un libro en memoria, escrito y vuelto a leer como lo haría la ruta. */
async function enBytes(armar: (hoja: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const libro = new ExcelJS.Workbook();
  armar(libro.addWorksheet("Octubre"));
  return new Uint8Array(await libro.xlsx.writeBuffer());
}

async function filasDe(bytes: Uint8Array) {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(bytes.buffer as ArrayBuffer);
  return filasDeLaHoja(libro.worksheets[0]);
}

/** El archivo real de octubre, en chiquito: encabezado, tres tareas y el total. */
function comoElDeOctubre(hoja: ExcelJS.Worksheet): void {
  hoja.getCell("A1").value = "Tarea";
  hoja.getCell("B1").value = "Fecha Desde";
  hoja.getCell("C1").value = "Fecha Hasta";
  hoja.getCell("D1").value = "Hs";
  hoja.getCell("E1").value = "Precio ($)";

  const filas: Array<[string, string, string, number]> = [
    ["Alambrado DG", "16/10/2026", "18/10/2026", 60],
    ["Tranqueras DG", "06/10/2026", "23/10/2026", 84],
    ["Pasillos idratación", "24/10/2026", "31/10/2026", 106],
  ];
  filas.forEach(([t, d, h, hs], i) => {
    const f = i + 2;
    hoja.getCell(`A${f}`).value = t;
    hoja.getCell(`B${f}`).value = d;
    hoja.getCell(`C${f}`).value = h;
    hoja.getCell(`D${f}`).value = hs;
  });

  hoja.getCell("A5").value = "TOTALES";
  hoja.getCell("D5").value = 250;
}

describe("abrir el .xlsx", () => {
  it("un #REF! llega como error y no como celda vacía", async () => {
    // Es la fila 24 del archivo real: la referencia quedó rota al sacar el
    // detalle. Si llegara como null, el renglón diría «no trae fecha» y nadie
    // sabría que hay algo que arreglar en la planilla.
    const bytes = await enBytes((h) => {
      h.getCell("B24").value = { formula: "#REF!", result: { error: "#REF!" } } as unknown as ExcelJS.CellValue;
    });
    const celda = (await filasDe(bytes))[0].celdas.B;

    expect(celda).toEqual({ formula: "#REF!", resultado: { error: "#REF!" } });
  });

  it("una fórmula llega como fórmula y no sólo como su resultado", async () => {
    const bytes = await enBytes((h) => {
      h.getCell("E66").value = { formula: "SUM(E2:E65)", result: 1074 };
    });
    expect((await filasDe(bytes))[0].celdas.E).toEqual({ formula: "SUM(E2:E65)", resultado: 1074 });
  });

  it("una fórmula sin resultado calculado conserva esa diferencia", async () => {
    const bytes = await enBytes((h) => {
      h.getCell("D2").value = { formula: "SUM(D3:D9)" } as unknown as ExcelJS.CellValue;
    });
    const celda = (await filasDe(bytes))[0].celdas.D as { formula: string; resultado?: unknown };

    expect(celda.formula).toBe("SUM(D3:D9)");
    expect(celda.resultado).toBeUndefined();
  });

  it("un texto, un número y una fecha llegan pelados", async () => {
    const bytes = await enBytes((h) => {
      h.getCell("A1").value = "Alambrado DG";
      h.getCell("B1").value = new Date("2026-10-16T00:00:00Z");
      h.getCell("D1").value = 12.5;
    });
    const { celdas } = (await filasDe(bytes))[0];

    expect(celdas.A).toBe("Alambrado DG");
    expect(celdas.B).toBeInstanceOf(Date);
    expect((celdas.B as Date).toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(celdas.D).toBe(12.5);
  });

  it("las letras salen de la dirección de la celda y no de contar columnas", async () => {
    // El off-by-one de `letraDeColumna` ya costó seis OT escritas en la columna
    // del equipo: acá la E tiene que ser la E aunque la fila empiece con huecos.
    const bytes = await enBytes((h) => {
      h.getCell("A5").value = "Alambrado";
      h.getCell("E5").value = 920000;
    });
    const fila = (await filasDe(bytes))[0];

    expect(fila.fila).toBe(5);
    expect(fila.celdas.A).toBe("Alambrado");
    expect(fila.celdas.E).toBe(920000);
    expect(fila.celdas.C).toBeUndefined();
  });

  it("de punta a punta: el archivo da una tarea por fila y la cuenta cierra", async () => {
    const lectura = await interpretarArchivo(await enBytes(comoElDeOctubre));
    expect(lectura.ok).toBe(true);
    if (!lectura.ok) return;

    expect(lectura.columnas).toEqual({ tarea: "A", desde: "B", hasta: "C", horas: "D", precio: "E" });
    expect(lectura.renglones.map((r) => [r.fila, r.tarea, r.desde, r.hasta, r.horas])).toEqual([
      [2, "Alambrado DG", "2026-10-16", "2026-10-18", 60],
      [3, "Tranqueras DG", "2026-10-06", "2026-10-23", 84],
      [4, "Pasillos idratación", "2026-10-24", "2026-10-31", 106],
    ]);
    expect(lectura.control).toMatchObject({ hay_total: true, cierra: true, horas_filas: 250, horas_total: 250 });
    expect(lectura.problemas).toEqual([]);
  });

  it("la hoja no es siempre la primera: gana la que tiene el encabezado", async () => {
    const libro = new ExcelJS.Workbook();
    libro.addWorksheet("Notas").getCell("A1").value = "acordarse de pedir los remitos";
    comoElDeOctubre(libro.addWorksheet("Octubre"));

    const lectura = await interpretarArchivo(new Uint8Array(await libro.xlsx.writeBuffer()));
    expect(lectura.ok).toBe(true);
    if (lectura.ok) expect(lectura.renglones).toHaveLength(3);
  });

  it("sin ninguna hoja con encabezado se dice qué había, y no se inventa", async () => {
    const bytes = await enBytes((h) => { h.getCell("A1").value = "cualquier cosa"; });
    const lectura = await interpretarArchivo(bytes);

    expect(lectura.ok).toBe(false);
    if (!lectura.ok) expect(lectura.error).toContain("«Tarea»");
  });

  it("lo que no es un .xlsx no se abre, y lo dice", async () => {
    const lectura = await interpretarArchivo(new TextEncoder().encode("esto es un texto"));

    expect(lectura.ok).toBe(false);
    if (!lectura.ok) expect(lectura.error).toMatch(/^No se pudo abrir el archivo: /);
  });
});
