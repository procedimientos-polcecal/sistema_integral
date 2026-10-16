import ExcelJS from "exceljs";
import { beforeAll, describe, it, expect } from "vitest";
import { armarLibroInforme } from "./informeExcel";
import type { ParteParaInformeMensual } from "./informeMensual";

function parte(p: Partial<ParteParaInformeMensual>): ParteParaInformeMensual {
  return {
    fecha: "2026-08-03", estado: "opero", material: "Dolomita", origen: "D1",
    horasMantenimiento: 0, horasFaltaPiedra: 0, horasProduccion: 0, horasOtro: 0,
    camionesLlegados: 10, toneladasProcesadas: 100, ...p,
  };
}

const PLANTAS = [
  { nombre: "Planta 1", partes: [
    parte({ fecha: "2026-08-03", horasFaltaPiedra: 2 }),
    // dos turnos el mismo día: es UN día operativo
    parte({ fecha: "2026-08-04", toneladasProcesadas: 50 }),
    parte({ fecha: "2026-08-04", toneladasProcesadas: 70, material: "Caliza + Chocolata" }),
    parte({ fecha: "2026-08-05", estado: "no_opero", toneladasProcesadas: null, camionesLlegados: null, material: null, origen: null }),
  ] },
  { nombre: "Planta 2", partes: [parte({ fecha: "2026-08-03", horasMantenimiento: 1.5, origen: "LOMA NEGRA" })] },
];

describe("armarLibroInforme", () => {
  // Se lee de vuelta desde el archivo escrito, que es lo que ve quien lo abre: en memoria,
  // exceljs oculta con `.value` un resultado 0 aunque en el archivo sí quede (se ve en `.model`).
  const wb = new ExcelJS.Workbook();
  beforeAll(async () => {
    const buffer = await armarLibroInforme("2026-08", PLANTAS, "ahora").xlsx.writeBuffer();
    await wb.xlsx.load(buffer as ArrayBuffer);
  });

  it("tiene las tres hojas", () => {
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Informe", "Partes", "Cómo se calcula"]);
  });

  it("la hoja Partes tiene una fila por parte, con todos los estados", () => {
    expect(wb.getWorksheet("Partes")!.rowCount).toBe(1 + 5);
  });

  it("un día con dos turnos suma un solo día operativo en el helper", () => {
    const wp = wb.getWorksheet("Partes")!;
    const marcas = [2, 3, 4, 5, 6].map((r) => (wp.getCell(r, 12).model as { result: number }).result);
    expect(marcas).toEqual([1, 1, 0, 0, 1]); // P1: 03/08, 04/08 (1er turno), 04/08 (2º), 05/08 no operó; P2: 03/08
  });

  it("las cifras del Informe son fórmulas, no valores pegados", () => {
    const ws = wb.getWorksheet("Informe")!;
    let formulas = 0;
    let numerosSueltos = 0;
    ws.eachRow((row) => row.eachCell((c) => {
      if (c.value && typeof c.value === "object" && "formula" in c.value) formulas++;
      else if (typeof c.value === "number") numerosSueltos++;
    }));
    expect(formulas).toBeGreaterThan(60);
    expect(numerosSueltos).toBe(1); // sólo las 8 horas por día operativo
  });

  it("el resultado precalculado de Días operativos y Toneladas coincide con el informe", () => {
    const ws = wb.getWorksheet("Informe")!;
    // Tabla 2, planta 1: días=2, hs teór=16, toneladas=220
    let fila = 0;
    ws.eachRow((row, n) => { if (row.getCell(1).value === "▸ TABLA N°2 — DATOS OPERATIVOS POR PLANTA") fila = n; });
    const r = (col: number) => (ws.getCell(fila + 2, col).model as { result: number }).result;
    expect(r(2)).toBe(2);
    expect(r(3)).toBe(16);
    expect(r(6)).toBe(220);
  });
});
