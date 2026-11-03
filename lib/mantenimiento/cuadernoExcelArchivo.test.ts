import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { filasDeLaHoja, interpretarArchivo } from "./cuadernoExcelArchivo";

/**
 * Lo que prueba este archivo es **una sola cosa, y es la que sostiene todo el
 * resto**: que una fórmula sobreviva de `exceljs` al intérprete. Si
 * `=C2+C3+C4` llegara aplanada a su resultado, el número entraría igual y
 * nadie vería nada raro — sólo que no habría ni un grupo, porque la fórmula es
 * lo único que dice qué renglones van juntos en una OT.
 *
 * Las decisiones (qué es un renglón, qué es un grupo, si la cuenta cierra)
 * están probadas en `cuadernoExcel.test.ts` sobre filas escritas a mano. Acá se
 * arma un `.xlsx` de verdad y se lo lee, que es lo único que no se puede
 * probar sin el archivo.
 */

/** Un libro en memoria, escrito y vuelto a leer como lo haría la ruta. */
async function enBytes(armar: (hoja: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
  const libro = new ExcelJS.Workbook();
  armar(libro.addWorksheet("Octubre"));
  return new Uint8Array(await libro.xlsx.writeBuffer());
}

function conElDetalleYSuResumen(hoja: ExcelJS.Worksheet): void {
  hoja.getCell("A1").value = "Fecha";
  hoja.getCell("B1").value = "Tarea";
  hoja.getCell("C1").value = "Horas";
  hoja.getCell("D1").value = "Precio";
  hoja.getCell("K1").value = "Tarea";
  hoja.getCell("N1").value = "Horas";

  const detalle: Array<[string, string, number]> = [
    ["2026-10-01", "Tranqueras D6", 2],
    ["2026-10-02", "Limpieza planta TRT Nº2", 20],
    ["2026-10-03", "Tranqueras D6", 12],
  ];
  detalle.forEach(([fecha, tarea, horas], i) => {
    const f = i + 2;
    hoja.getCell(`A${f}`).value = new Date(`${fecha}T00:00:00Z`);
    hoja.getCell(`B${f}`).value = tarea;
    hoja.getCell(`C${f}`).value = horas;
  });

  // El resumen: la fórmula es la que dice qué va junto.
  hoja.getCell("K2").value = "Tranqueras D6";
  hoja.getCell("N2").value = { formula: "C2+C4", result: 14 };
  hoja.getCell("K3").value = "Limpieza planta TRT Nº2";
  hoja.getCell("N3").value = { formula: "C3", result: 20 };
}

describe("abrir el .xlsx", () => {
  it("una fórmula llega como fórmula y no como su resultado", async () => {
    const bytes = await enBytes((h) => {
      h.getCell("N2").value = { formula: "C47+C50+C51", result: 46 };
    });
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(bytes.buffer as ArrayBuffer);
    const celda = filasDeLaHoja(libro.worksheets[0])[0].celdas.N;

    expect(celda).toEqual({ formula: "C47+C50+C51", resultado: 46 });
  });

  it("un texto, un número y una fecha llegan pelados", async () => {
    const bytes = await enBytes((h) => {
      h.getCell("A1").value = new Date("2026-10-01T00:00:00Z");
      h.getCell("B1").value = "Tranqueras D6";
      h.getCell("C1").value = 12.5;
    });
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(bytes.buffer as ArrayBuffer);
    const { celdas } = filasDeLaHoja(libro.worksheets[0])[0];

    expect(celdas.A).toBeInstanceOf(Date);
    expect((celdas.A as Date).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(celdas.B).toBe("Tranqueras D6");
    expect(celdas.C).toBe(12.5);
  });

  it("las letras salen de la dirección de la celda y no de contar columnas", async () => {
    // El off-by-one de `letraDeColumna` ya costó seis OT escritas en la columna
    // del equipo: acá la K tiene que ser la K aunque la hoja empiece llena de
    // huecos.
    const bytes = await enBytes((h) => {
      h.getCell("A5").value = "primera";
      h.getCell("K5").value = "resumen";
      h.getCell("N5").value = 8;
    });
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(bytes.buffer as ArrayBuffer);
    const fila = filasDeLaHoja(libro.worksheets[0])[0];

    expect(fila.fila).toBe(5);
    expect(fila.celdas.K).toBe("resumen");
    expect(fila.celdas.N).toBe(8);
    expect(fila.celdas.B).toBeUndefined();
  });

  it("de punta a punta: el archivo da renglones y los grupos del resumen", async () => {
    const lectura = await interpretarArchivo(await enBytes(conElDetalleYSuResumen));
    expect(lectura.ok).toBe(true);
    if (!lectura.ok) return;

    expect(lectura.renglones.map((r) => [r.fila, r.fecha, r.tarea, r.horas])).toEqual([
      [2, "2026-10-01", "Tranqueras D6", 2],
      [3, "2026-10-02", "Limpieza planta TRT Nº2", 20],
      [4, "2026-10-03", "Tranqueras D6", 12],
    ]);
    expect(lectura.control.cierra).toBe(true);
    expect(lectura.control.horas_detalle).toBe(34);
    expect(lectura.grupos.map((g) => g.filas)).toEqual([[2, 4], [3]]);
  });

  it("la hoja no es siempre la primera: gana la que tiene el encabezado", async () => {
    const libro = new ExcelJS.Workbook();
    const notas = libro.addWorksheet("Notas");
    notas.getCell("A1").value = "acordarse de pedir los remitos";
    conElDetalleYSuResumen(libro.addWorksheet("Octubre"));
    const bytes = new Uint8Array(await libro.xlsx.writeBuffer());

    const lectura = await interpretarArchivo(bytes);
    expect(lectura.ok).toBe(true);
    if (lectura.ok) expect(lectura.renglones).toHaveLength(3);
  });

  it("sin ninguna hoja con encabezado se dice qué había, y no se inventa", async () => {
    const bytes = await enBytes((h) => { h.getCell("A1").value = "cualquier cosa"; });
    const lectura = await interpretarArchivo(bytes);

    expect(lectura.ok).toBe(false);
    if (!lectura.ok) expect(lectura.error).toMatch(/encabezado|Fecha/i);
  });

  it("lo que no es un .xlsx no se abre, y lo dice", async () => {
    const lectura = await interpretarArchivo(new TextEncoder().encode("esto es un texto"));

    expect(lectura.ok).toBe(false);
    if (!lectura.ok) expect(lectura.error).toMatch(/^No se pudo abrir el archivo: /);
  });
});
