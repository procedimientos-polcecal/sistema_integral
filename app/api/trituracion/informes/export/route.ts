import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { tieneAccesoTrituracion } from "@/lib/trituracion/auth";
import { traerPartes, traerPlantas } from "@/lib/trituracion/consultas";
import { informeMensualPorPlanta, toneladasPorOrigen, type ParteParaInformeMensual } from "@/lib/trituracion/informeMensual";

/**
 * El .xlsx del informe mensual de plantas de trituración, calcado del
 * formato real ("Informe Mensual"/"AGOSTO" del Sheets: verde/ámbar, cebra,
 * fila CONSOLIDADO) — mismo patrón que `/api/cantera/informes/export`, con
 * `exceljs` (no la `xlsx`/SheetJS del resto del repo, que en su edición
 * gratuita no pinta celdas al escribir).
 */

const VERDE = "FF1E7D34";
const VERDE_CLARO = "FFF0F8F5";
const AMBAR = "FFB45309";
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

function aParteInforme(p: {
  fecha: string; estado: string; material: string | null; origen: string | null;
  horas_mantenimiento: number; horas_falta_piedra: number; horas_produccion: number; horas_otro: number;
  camiones_llegados: number | null; toneladas_procesadas: number | null;
}): ParteParaInformeMensual {
  return {
    fecha: p.fecha,
    estado: p.estado as "opero" | "no_opero",
    material: p.material,
    origen: p.origen,
    horasMantenimiento: p.horas_mantenimiento,
    horasFaltaPiedra: p.horas_falta_piedra,
    horasProduccion: p.horas_produccion,
    horasOtro: p.horas_otro,
    camionesLlegados: p.camiones_llegados,
    toneladasProcesadas: p.toneladas_procesadas,
  };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoTrituracion(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Trituración" }, { status: 403 });
  }

  const url = new URL(request.url);
  const mes = url.searchParams.get("mes");
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ error: "Falta mes (YYYY-MM)" }, { status: 400 });
  }

  const plantas = await traerPlantas(supabase);
  const desde = `${mes}-01`;
  const [anio, mesNum] = mes.split("-").map(Number);
  const hasta = new Date(Date.UTC(anio, mesNum, 0)).toISOString().slice(0, 10);
  const partesPorPlanta = await Promise.all(
    plantas.map((p) => traerPartes(supabase, { plantaId: p.id, desde, hasta }))
  );
  const partesDelMes = partesPorPlanta.map((partes) => partes.map(aParteInforme));
  const informesPorPlanta = plantas.map((planta, i) => ({
    planta,
    informe: informeMensualPorPlanta(partesDelMes[i], mes),
  }));
  const origenes = toneladasPorOrigen(partesDelMes.flat());
  const totalOrigenes = origenes.reduce((s, o) => s + o.toneladas, 0);
  const hayMaterialSinClasificar = informesPorPlanta.some(({ informe }) => informe.porMaterial.sinClasificar > 0);

  const suma = (f: (i: (typeof informesPorPlanta)[number]["informe"]) => number) =>
    informesPorPlanta.reduce((s, { informe }) => s + f(informe), 0);
  const consolidado = {
    diasOperativos: suma((i) => i.diasOperativos),
    horasTeoricas: suma((i) => i.horasTeoricas),
    horasReales: suma((i) => i.horasReales),
    viajes: suma((i) => i.viajes),
    toneladas: suma((i) => i.toneladas),
    horasFaltaPiedra: suma((i) => i.horasFaltaPiedra),
    horasMantenimiento: suma((i) => i.horasMantenimiento),
    horasVarios: suma((i) => i.horasVarios),
    dolomita: suma((i) => i.porMaterial.dolomita),
    chocolata: suma((i) => i.porMaterial.chocolata),
    caliza: suma((i) => i.porMaterial.caliza),
    sinClasificar: suma((i) => i.porMaterial.sinClasificar),
  };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Informe", { views: [{ state: "frozen", ySplit: 2 }] });
  const ANCHO = 7; // columnas de la tabla más ancha (Tabla N°4)

  ws.columns = Array.from({ length: ANCHO }, () => ({ width: 20 }));

  let fila = 1;
  ws.mergeCells(fila, 1, fila, ANCHO);
  ws.getCell(fila, 1).value = `INFORME DE PLANTAS DE TRITURACIÓN — ${mes}`;
  ws.getCell(fila, 1).font = { bold: true, color: { argb: BLANCO }, size: 13 };
  for (let c = 1; c <= ANCHO; c++) ws.getCell(fila, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
  fila++;

  ws.mergeCells(fila, 1, fila, ANCHO);
  ws.getCell(fila, 1).value = `Generado: ${new Date().toLocaleString("es-AR")}`;
  ws.getCell(fila, 1).font = { italic: true, size: 9, color: { argb: "FF64748B" } };
  for (let c = 1; c <= ANCHO; c++) ws.getCell(fila, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE_CLARO } };
  fila += 2;

  const nombres = informesPorPlanta.map(({ planta }) => planta.nombre.toUpperCase());

  // ── Tabla N°1 — KPIs operacionales por planta ──
  tituloSeccion(ws, fila, "▸ TABLA N°1 — KPIs OPERACIONALES POR PLANTA", VERDE, ANCHO);
  fila++;
  filaEncabezado(ws, fila, ["Indicador", ...nombres], VERDE);
  fila++;
  const filasKpi: [string, (i: (typeof informesPorPlanta)[number]["informe"]) => unknown][] = [
    ["Productividad media (t/h marcha)", (i) => i.productividadTHMarcha],
    ["Toneladas por viaje", (i) => i.toneladasPorViaje],
    ["Horas perdidas totales", (i) => i.horasPerdidasTotal],
    ["% horas perdidas s/ teóricas", (i) => i.pctHorasPerdidas],
    ["Días operativos", (i) => i.diasOperativos],
    ["Días con falta de piedra", (i) => i.diasConFaltaPiedra],
  ];
  filasKpi.forEach(([etiqueta, valor], i) => {
    filaDatos(ws, fila, [etiqueta, ...informesPorPlanta.map(({ informe }) => valor(informe))], i, VERDE_CLARO);
    fila++;
  });
  fila += 1;

  // ── Tabla N°2 — Datos operativos por planta ──
  tituloSeccion(ws, fila, "▸ TABLA N°2 — DATOS OPERATIVOS POR PLANTA", AMBAR, ANCHO);
  fila++;
  filaEncabezado(ws, fila, ["Planta", "Días operativos", "Hs teór.", "Hs reales", "Viajes", "Toneladas", "Producción (Tn/h)"], AMBAR);
  fila++;
  informesPorPlanta.forEach(({ planta, informe }, i) => {
    filaDatos(ws, fila, [planta.nombre.toUpperCase(), informe.diasOperativos, informe.horasTeoricas, informe.horasReales, informe.viajes, informe.toneladas, informe.productividadTHMarcha], i, AMBAR_CLARO);
    fila++;
  });
  filaTotales(ws, fila, ["CONSOLIDADO", consolidado.diasOperativos, consolidado.horasTeoricas, consolidado.horasReales, consolidado.viajes, consolidado.toneladas, consolidado.horasReales > 0 ? consolidado.toneladas / consolidado.horasReales : null], AMBAR);
  fila += 2;

  // ── Tabla N°3 — Horas improductivas por causa ──
  tituloSeccion(ws, fila, "▸ TABLA N°3 — HORAS IMPRODUCTIVAS POR CAUSA", VERDE, ANCHO);
  fila++;
  filaEncabezado(ws, fila, ["Planta", "Falta de piedra (hs)", "Mantenimiento (hs)", "Varios (hs)"], VERDE);
  fila++;
  informesPorPlanta.forEach(({ planta, informe }, i) => {
    filaDatos(ws, fila, [planta.nombre.toUpperCase(), informe.horasFaltaPiedra, informe.horasMantenimiento, informe.horasVarios], i, VERDE_CLARO);
    fila++;
  });
  filaTotales(ws, fila, ["CONSOLIDADO", consolidado.horasFaltaPiedra, consolidado.horasMantenimiento, consolidado.horasVarios], VERDE);
  fila += 2;

  // ── Tabla N°4 — Coeficientes de gestión del tiempo ──
  tituloSeccion(ws, fila, "▸ TABLA N°4 — COEFICIENTES DE GESTIÓN DEL TIEMPO", AMBAR, ANCHO);
  fila++;
  filaEncabezado(ws, fila, ["Planta", "Disponibilidad", "Utilización", "Dirección", "Falta de piedra (%)", "Mantenimiento (%)", "Varios (%)"], AMBAR);
  fila++;
  informesPorPlanta.forEach(({ planta, informe }, i) => {
    filaDatos(ws, fila, [planta.nombre.toUpperCase(), informe.disponibilidad, informe.utilizacion, informe.direccion, informe.pctFaltaPiedra, informe.pctMantenimiento, informe.pctVarios], i, AMBAR_CLARO);
    fila++;
  });
  fila += 1;

  // ── Tabla N°5 — Toneladas procesadas por material ──
  tituloSeccion(ws, fila, "▸ TABLA N°5 — TONELADAS PROCESADAS POR MATERIAL", VERDE, ANCHO);
  fila++;
  const colsMaterial = ["Planta", "Dolomita", "Chocolata", "Caliza", ...(hayMaterialSinClasificar ? ["Sin clasificar"] : []), "Total Procesado (Tn)"];
  filaEncabezado(ws, fila, colsMaterial, VERDE);
  fila++;
  informesPorPlanta.forEach(({ planta, informe }, i) => {
    const valores: unknown[] = [planta.nombre.toUpperCase(), informe.porMaterial.dolomita, informe.porMaterial.chocolata, informe.porMaterial.caliza];
    if (hayMaterialSinClasificar) valores.push(informe.porMaterial.sinClasificar);
    valores.push(informe.porMaterial.total);
    filaDatos(ws, fila, valores, i, VERDE_CLARO);
    fila++;
  });
  const totalesMaterial: unknown[] = ["CONSOLIDADO", consolidado.dolomita, consolidado.chocolata, consolidado.caliza];
  if (hayMaterialSinClasificar) totalesMaterial.push(consolidado.sinClasificar);
  totalesMaterial.push(consolidado.dolomita + consolidado.chocolata + consolidado.caliza + consolidado.sinClasificar);
  filaTotales(ws, fila, totalesMaterial, VERDE);
  fila += 2;

  // ── Tabla N°6 — Toneladas acarreadas por cantera ──
  tituloSeccion(ws, fila, "▸ TABLA N°6 — TONELADAS ACARREADAS POR CANTERA", AMBAR, ANCHO);
  fila++;
  filaEncabezado(ws, fila, ["Cantera", "Toneladas"], AMBAR);
  fila++;
  origenes.forEach((o, i) => {
    filaDatos(ws, fila, [o.origen, o.toneladas], i, AMBAR_CLARO);
    fila++;
  });
  if (origenes.length > 0) filaTotales(ws, fila, ["TOTAL", totalOrigenes], AMBAR);

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="trituracion_informe_${mes}.xlsx"`,
    },
  });
}
