import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { tieneAccesoTallerVial } from "@/lib/tallerVial/auth";
import { traerCargas, traerEquiposTallerVial, traerEstadosDiarios } from "@/lib/tallerVial/consultas";
import { calcularTrabajoEntreCargas } from "@/lib/tallerVial/combustible";
import { resumenMensualDeEstados, type EstadoDiario } from "@/lib/tallerVial/estados";
import { armarInformeConsumo, armarInformeDisponibilidad } from "@/lib/tallerVial/informe";
import { ETIQUETA_UNIDAD, unidadDeUso } from "@/lib/tallerVial/equipos";

/**
 * El .xlsx del informe mensual de Taller Vial, con el mismo formato que el de
 * Cantera (`app/api/cantera/informes/export/route.ts`) — mismos colores y
 * misma librería (`exceljs`, no `xlsx`/SheetJS, que en su edición gratuita no
 * pinta celdas). Se pidió "mismo formato de colores y tipografía que
 * Cantera", así que reutiliza los mismos hex en vez de inventar una paleta
 * propia para el módulo.
 */

const VERDE = "FF1E7D34";
const VERDE_CLARO = "FFF0F8F5";
const AMBAR = "FFE8A020";
const AMBAR_CLARO = "FFFFF7ED";
const BLANCO = "FFFFFFFF";

function tituloSeccion(ws: ExcelJS.Worksheet, fila: number, texto: string, color: string, ancho: number) {
  ws.mergeCells(fila, 1, fila, ancho);
  const c = ws.getCell(fila, 1);
  c.value = texto;
  c.font = { bold: true, color: { argb: BLANCO }, size: 11 };
  for (let col = 1; col <= ancho; col++) {
    ws.getCell(fila, col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  }
}

function filaEncabezado(ws: ExcelJS.Worksheet, fila: number, columnas: string[], color: string) {
  columnas.forEach((texto, i) => {
    const c = ws.getCell(fila, i + 1);
    c.value = texto;
    c.font = { bold: true, color: { argb: BLANCO } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  });
}

function filaDatos(ws: ExcelJS.Worksheet, fila: number, valores: unknown[], indice: number, claro: string) {
  valores.forEach((v, i) => {
    const c = ws.getCell(fila, i + 1);
    c.value = v as ExcelJS.CellValue;
    if (indice % 2 === 1) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: claro } };
  });
}

function filaTotales(ws: ExcelJS.Worksheet, fila: number, valores: unknown[], color: string) {
  valores.forEach((v, i) => {
    const c = ws.getCell(fila, i + 1);
    c.value = v as ExcelJS.CellValue;
    c.font = { bold: true, color: { argb: BLANCO } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
  });
}

const NOMBRE_MES = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
function nombreDeMes(mes: string): string {
  const texto = NOMBRE_MES.format(new Date(`${mes}-01T00:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoTallerVial(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Taller Vial" }, { status: 403 });
  }

  const url = new URL(request.url);
  const mes = url.searchParams.get("mes");
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ error: "Falta mes (YYYY-MM)" }, { status: 400 });
  }

  const [equipos, todasLasCargas, todosLosEstados] = await Promise.all([
    traerEquiposTallerVial(supabase),
    traerCargas(supabase, {}),
    traerEstadosDiarios(supabase, {}),
  ]);
  const porId = new Map(equipos.map((e) => [e.id, e]));

  const cargasConTrabajo = calcularTrabajoEntreCargas(
    todasLasCargas
      .filter((c) => c.equipo_id !== null)
      .map((c) => ({ id: c.id, equipoId: c.equipo_id!, fecha: c.fecha, litros: c.litros, lectura: c.lectura }))
  );
  const consumo = armarInformeConsumo(cargasConTrabajo, mes)
    .map((f) => ({ ...f, equipo: porId.get(f.equipoId) }))
    .filter((f): f is typeof f & { equipo: NonNullable<typeof f.equipo> } => Boolean(f.equipo))
    .sort((a, b) => b.litrosTotal - a.litrosTotal);

  const estadosPlanos = todosLosEstados.map((e) => ({ equipoId: e.equipo_id, fecha: e.fecha, estado: e.estado as EstadoDiario }));
  const resumenEstados = resumenMensualDeEstados(estadosPlanos, mes);
  const disponibilidad = armarInformeDisponibilidad(resumenEstados)
    .map((f) => ({ ...f, equipo: porId.get(f.equipoId) }))
    .filter((f): f is typeof f & { equipo: NonNullable<typeof f.equipo> } => Boolean(f.equipo))
    .sort((a, b) => (a.disponibilidadPct ?? 0) - (b.disponibilidadPct ?? 0));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Informe", { views: [{ state: "frozen", ySplit: 2 }] });
  const ANCHO = 6; // columnas de la sección más ancha (consumo)

  ws.columns = Array.from({ length: ANCHO }, () => ({ width: 20 }));

  let fila = 1;
  ws.mergeCells(fila, 1, fila, ANCHO);
  ws.getCell(fila, 1).value = `INFORME DE EQUIPOS MÓVILES — ${nombreDeMes(mes).toUpperCase()}`;
  ws.getCell(fila, 1).font = { bold: true, color: { argb: BLANCO }, size: 13 };
  for (let c = 1; c <= ANCHO; c++) ws.getCell(fila, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
  fila++;

  ws.mergeCells(fila, 1, fila, ANCHO);
  ws.getCell(fila, 1).value = `Generado: ${new Date().toLocaleString("es-AR")}   |   La referencia histórica y la disponibilidad se calculan distinto de la planilla real`;
  ws.getCell(fila, 1).font = { italic: true, size: 9, color: { argb: "FF64748B" } };
  for (let c = 1; c <= ANCHO; c++) ws.getCell(fila, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE_CLARO } };
  fila += 2;

  // ── Resumen de consumo por equipo ──
  tituloSeccion(ws, fila, "▸ RESUMEN DE CONSUMO POR EQUIPO", VERDE, ANCHO);
  fila++;
  filaEncabezado(ws, fila, ["Equipo", "Cargas", "Litros", "Consumo del mes", "Ref. histórica", "Desvío"], VERDE);
  fila++;
  consumo.forEach((f, i) => {
    const unidad = unidadDeUso(f.equipo.code);
    filaDatos(ws, fila, [
      `${f.equipo.code} - ${f.equipo.name}`,
      f.cargas,
      f.litrosTotal,
      f.consumoDelMes !== null ? `${f.consumoDelMes.toFixed(1)} L/${ETIQUETA_UNIDAD[unidad]}` : "—",
      f.referenciaHistorica !== null ? `${f.referenciaHistorica.toFixed(1)} L/${ETIQUETA_UNIDAD[unidad]}` : "—",
      f.desvio !== null ? `${f.desvio >= 0 ? "+" : ""}${f.desvio.toFixed(1)}` : "—",
    ], i, VERDE_CLARO);
    fila++;
  });
  if (consumo.length === 0) { ws.getCell(fila, 1).value = "Sin cargas de combustible este mes."; fila++; }
  else {
    filaTotales(ws, fila, [
      "TOTALES",
      consumo.reduce((s, f) => s + f.cargas, 0),
      consumo.reduce((s, f) => s + f.litrosTotal, 0),
      "", "", "",
    ], VERDE);
    fila++;
  }
  fila += 1;

  // ── Disponibilidad ──
  tituloSeccion(ws, fila, "▸ DISPONIBILIDAD", AMBAR, ANCHO);
  fila++;
  filaEncabezado(ws, fila, ["Equipo", "Días operativo", "Días con dato", "Disponibilidad"], AMBAR);
  fila++;
  disponibilidad.forEach((f, i) => {
    filaDatos(ws, fila, [
      `${f.equipo.code} - ${f.equipo.name}`,
      f.diasOperativo,
      f.diasRegistrados,
      f.disponibilidadPct !== null ? `${f.disponibilidadPct.toFixed(1)}%` : "—",
    ], i, AMBAR_CLARO);
    fila++;
  });
  if (disponibilidad.length === 0) { ws.getCell(fila, 1).value = "Sin estados cargados este mes."; fila++; }
  else {
    const pctsValidos = disponibilidad.map((f) => f.disponibilidadPct).filter((p): p is number => p !== null);
    const promedio = pctsValidos.length > 0 ? pctsValidos.reduce((s, p) => s + p, 0) / pctsValidos.length : null;
    filaTotales(ws, fila, ["PROMEDIO FLOTA", "", "", promedio !== null ? `${promedio.toFixed(1)}%` : "—"], AMBAR);
    fila++;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="taller_vial_informe_${mes}.xlsx"`,
    },
  });
}
