import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseDateString, parseMarcaciones, parseNumeroAR, parseWorkbookAllSheets } from "./excelImport";

describe("parseDateString", () => {
  it("interpreta DD/MM/YYYY con prefijo de día de semana (formato reloj)", () => {
    const d = parseDateString("Lu 01/06/2026");
    expect(d?.getUTCFullYear()).toBe(2026);
    expect(d?.getUTCMonth()).toBe(5); // junio = índice 5
    expect(d?.getUTCDate()).toBe(1);
  });

  it("interpreta DD/MM/YYYY sin prefijo", () => {
    const d = parseDateString("25/12/2026");
    expect(d?.getUTCMonth()).toBe(11);
    expect(d?.getUTCDate()).toBe(25);
  });

  it("interpreta ISO YYYY-MM-DD", () => {
    const d = parseDateString("2026-07-09");
    expect(d?.getUTCMonth()).toBe(6);
    expect(d?.getUTCDate()).toBe(9);
  });
});

describe("parseMarcaciones", () => {
  it("interpreta un par entrada/salida simple", () => {
    const pares = parseMarcaciones("E 08:07 - S 15:56");
    expect(pares).toEqual([{ entradaStr: "08:07", salidaStr: "15:56" }]);
  });

  it("interpreta varios tramos (corte de almuerzo)", () => {
    const pares = parseMarcaciones("E 08:00 - S 12:00  E 13:00 - S 17:00");
    expect(pares).toEqual([
      { entradaStr: "08:00", salidaStr: "12:00" },
      { entradaStr: "13:00", salidaStr: "17:00" },
    ]);
  });

  it("marca como abierta una entrada sin salida (marcación faltante)", () => {
    const pares = parseMarcaciones("E 08:07");
    expect(pares).toEqual([{ entradaStr: "08:07", salidaStr: null }]);
  });

  it("cadena vacía no produce marcaciones", () => {
    expect(parseMarcaciones("")).toEqual([]);
  });
});

function bufferDeFilas(filas: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Marcaciones y Horas");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("parseWorkbookAllSheets", () => {
  it("detecta el encabezado real cuando el reporte trae filas de filtros/título antes (caso reloj biométrico)", () => {
    const buf = bufferDeFilas([
      ["Filtros", "", "Fecha Desde: 22/07/2026", "Fecha Hasta: 27/07/2026"],
      ["", "", "", ""],
      ["Empleado", "Legajo", "Fecha", "Marcaciones"],
      ["AGOSTA, HORACIO", "PC_233", "Mi 22/07/2026", "E 11:50 - S 19:46"],
      ["ROSSI, NICOLAS", "PS_019", "Ju 23/07/2026", "E 08:05 - S 16:02"],
    ]);
    const { sheetNames, sheets } = parseWorkbookAllSheets(buf);
    const sheet = sheets[sheetNames[0]];
    expect(sheet.headers).toEqual(["Empleado", "Legajo", "Fecha", "Marcaciones"]);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0]).toMatchObject({ Empleado: "AGOSTA, HORACIO", Legajo: "PC_233" });
  });

  it("cuando el encabezado ya es la primera fila, se comporta igual que antes", () => {
    const buf = bufferDeFilas([
      ["Legajo", "Fecha", "Marcaciones"],
      ["PC_233", "Mi 22/07/2026", "E 11:50 - S 19:46"],
    ]);
    const { sheetNames, sheets } = parseWorkbookAllSheets(buf);
    const sheet = sheets[sheetNames[0]];
    expect(sheet.headers).toEqual(["Legajo", "Fecha", "Marcaciones"]);
    expect(sheet.rows).toHaveLength(1);
  });
});

describe("parseNumeroAR", () => {
  it("interpreta formato argentino con miles y decimales", () => {
    expect(parseNumeroAR("3.500,50")).toBeCloseTo(3500.5);
  });
  it("interpreta formato argentino solo con decimales", () => {
    expect(parseNumeroAR("3500,5")).toBeCloseTo(3500.5);
  });
  it("interpreta número plano", () => {
    expect(parseNumeroAR("3500")).toBe(3500);
    expect(parseNumeroAR(3500)).toBe(3500);
  });

  /**
   * Sin coma, el punto seguido de tres digitos es separador de miles. Es como
   * se escribe aca, y esto lee el valor hora del import de empleados: "3.500"
   * entraba como 3,5 pesos la hora, sin error y sin aviso.
   */
  it("un punto con tres dígitos detrás son miles, no decimales", () => {
    expect(parseNumeroAR("3.500")).toBe(3500);
    expect(parseNumeroAR("1.234.567")).toBe(1234567);
    expect(parseNumeroAR("-3.500")).toBe(-3500);
  });

  it("cualquier otro punto sigue siendo decimal", () => {
    expect(parseNumeroAR("3500.5")).toBeCloseTo(3500.5);
    expect(parseNumeroAR("3.5")).toBeCloseTo(3.5);
    expect(parseNumeroAR("3.50")).toBeCloseTo(3.5);
    // Cuatro digitos delante: unos miles bien escritos serian "3.500.500".
    expect(parseNumeroAR("3500.500")).toBeCloseTo(3500.5);
  });

  it("el cero adelante desarma la regla de los miles", () => {
    expect(parseNumeroAR("0.500")).toBeCloseTo(0.5);
  });

  it("lo que no es un número no inventa uno", () => {
    expect(parseNumeroAR("s/d")).toBeNull();
    expect(parseNumeroAR("")).toBeNull();
    expect(parseNumeroAR(null)).toBeNull();
  });
});
