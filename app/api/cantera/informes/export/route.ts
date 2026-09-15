import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerDatosParaInforme } from "@/lib/cantera/consultas";
import { armarInforme, type ResumenPorCantera } from "@/lib/cantera/informe";

/**
 * El .xlsx del informe, calcado del formato de la planilla vieja: un solo
 * `.xlsx` con las secciones apiladas verde/ámbar, cebra y fila TOTALES —lo que
 * el usuario pidió como "exactamente igual: colores, tablas, información,
 * todo"—. Usa `exceljs` (no la `xlsx`/SheetJS del resto del repo, que en su
 * edición gratuita no pinta celdas al escribir).
 *
 * LOS DOS GRÁFICOS DE LA PLANILLA NO VAN ACÁ. `exceljs` no sabe escribir
 * gráficos nativos de Excel —no es un descuido, la librería no lo permite—,
 * y pegar una imagen estática en su lugar no sería un gráfico de Excel: sería
 * una foto que parece uno. Los dos gráficos (torta y barras) están en la
 * pantalla, con los mismos datos.
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
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
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

function filaTotales(ws: ExcelJS.Worksheet, fila: number, valores: unknown[]) {
  valores.forEach((v, i) => {
    const c = ws.getCell(fila, i + 1);
    c.value = v as ExcelJS.CellValue;
    c.font = { bold: true, color: { argb: BLANCO } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
  });
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }

  const url = new URL(request.url);
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");
  if (!desde || !hasta || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return NextResponse.json({ error: "Faltan desde/hasta (YYYY-MM-DD)" }, { status: 400 });
  }

  const { voladuras, bochones } = await traerDatosParaInforme(supabase);
  const informe = armarInforme(desde, hasta, voladuras, bochones);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Informe", { views: [{ state: "frozen", ySplit: 2 }] });
  const ANCHO = 10; // columnas del resumen por cantera, la sección más ancha

  ws.columns = Array.from({ length: ANCHO }, () => ({ width: 16 }));

  let fila = 1;
  ws.mergeCells(fila, 1, fila, ANCHO);
  ws.getCell(fila, 1).value = `INFORME DE CANTERAS — ${desde} a ${hasta}`;
  ws.getCell(fila, 1).font = { bold: true, color: { argb: BLANCO }, size: 13 };
  for (let c = 1; c <= ANCHO; c++) ws.getCell(fila, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE } };
  fila++;

  ws.mergeCells(fila, 1, fila, ANCHO);
  ws.getCell(fila, 1).value =
    `Generado: ${new Date().toLocaleString("es-AR")}   |   Filtro: fin de perforación / fecha de voladura / fecha de voladura del bochón`;
  ws.getCell(fila, 1).font = { italic: true, size: 9, color: { argb: "FF64748B" } };
  for (let c = 1; c <= ANCHO; c++) ws.getCell(fila, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: VERDE_CLARO } };
  fila += 2;

  // ── Resumen por cantera ──
  tituloSeccion(ws, fila, "▸ RESUMEN POR CANTERA", VERDE, ANCHO);
  fila++;
  const colsResumen = ["Cantera", "Toneladas", "Costo total USD", "Perf. USD", "Explosivo USD", "Accesorios USD", "Servicio USD", "Gr Expl./Ton", "USD/Ton", "Ton/m Perf."];
  filaEncabezado(ws, fila, colsResumen, VERDE);
  fila++;
  informe.porCantera.forEach((c: ResumenPorCantera, i) => {
    filaDatos(ws, fila, [
      c.cantera, c.toneladas, c.costoTotalUsd, c.perforacionUsd, c.detonadorUsd,
      c.otrosInsumosUsd, c.servicioUsd, c.grExplosivoPorTon, c.usdPorTon, c.tonPorMetroPerforado,
    ], i, VERDE_CLARO);
    fila++;
  });
  if (informe.porCantera.length === 0) { ws.getCell(fila, 1).value = "Sin actividad en el período."; fila++; }
  fila += 1;

  // ── Perforaciones ──
  tituloSeccion(ws, fila, "▸ PERFORACIONES DEL PERÍODO (por fin de perforación)", VERDE, ANCHO);
  fila++;
  filaEncabezado(ws, fila, ["Código", "Cantera", "Fin Perf.", "Prof. (mts)", "Pozos", "Metros Perf.", "Total USD", "Total ARS"], VERDE);
  fila++;
  informe.perforaciones.forEach((p, i) => {
    filaDatos(ws, fila, [p.codigo, p.cantera, p.fin, p.profundidadProm, p.pozos, p.metros, p.montoUsd, p.montoArs], i, VERDE_CLARO);
    fila++;
  });
  filaTotales(ws, fila, [
    "TOTALES", "", "", "",
    informe.perforaciones.reduce((s, p) => s + (p.pozos ?? 0), 0),
    informe.totales.metrosPerforados,
    informe.totales.perforacionUsd,
    informe.totales.perforacionArs,
  ]);
  fila += 2;

  // ── Voladuras ──
  tituloSeccion(ws, fila, "▸ VOLADURAS DEL PERÍODO (por fecha de voladura)", AMBAR, ANCHO);
  fila++;
  filaEncabezado(ws, fila, ["Código", "Cantera", "Fecha Voladura", "Gr Detonador", "Toneladas", "Total USD", "Total ARS"], AMBAR);
  fila++;
  informe.voladuras.forEach((v, i) => {
    filaDatos(ws, fila, [v.codigo, v.cantera, v.fecha, v.gramosDetonador, v.toneladas, v.montoUsd, v.montoArs], i, AMBAR_CLARO);
    fila++;
  });
  filaTotales(ws, fila, ["TOTALES", "", "", informe.totales.gramosDetonador, informe.totales.toneladas, informe.totales.voladuraUsd, informe.totales.voladuraArs]);
  fila += 2;

  // ── Bochones ──
  tituloSeccion(ws, fila, "▸ BOCHONES DEL PERÍODO (por fecha de voladura)", VERDE, ANCHO);
  fila++;
  filaEncabezado(ws, fila, ["Código", "Cantera", "Fecha Voladura", "Cantidad", "Metros/bochón", "Total USD", "Total ARS"], VERDE);
  fila++;
  informe.bochones.forEach((b, i) => {
    filaDatos(ws, fila, [b.codigo, b.cantera, b.fecha, b.cantidad, b.metros, b.montoUsd, b.montoArs], i, VERDE_CLARO);
    fila++;
  });
  filaTotales(ws, fila, ["TOTALES", "", "", "", "", informe.totales.bochonUsd, informe.totales.bochonArs]);
  fila += 2;

  // ── Consumos, agrupados por tipo con subtotal ──
  tituloSeccion(ws, fila, "▸ CONSUMOS DEL PERÍODO (detalle)", AMBAR, ANCHO);
  fila++;
  filaEncabezado(ws, fila, ["Código", "Tipo", "Insumo", "Cantidad", "Precio USD", "Total USD", "Total ARS"], AMBAR);
  fila++;
  const ETIQUETA_TIPO: Record<string, string> = { detonador: "Detonador", otros_insumos: "Otros insumos", voladura: "Voladura" };
  for (const tipo of ["detonador", "otros_insumos", "voladura"] as const) {
    const filasTipo = informe.consumosDetalle.filter((c) => c.tipo === tipo);
    if (filasTipo.length === 0) continue;
    filasTipo.forEach((c, i) => {
      filaDatos(ws, fila, [c.codigo, ETIQUETA_TIPO[c.tipo] ?? c.tipo, c.insumo, c.cantidad, c.precioUsd, c.totalUsd, c.totalArs], i, AMBAR_CLARO);
      fila++;
    });
    const subtUsd = filasTipo.reduce((s, c) => s + (c.totalUsd ?? 0), 0);
    const subtArs = filasTipo.reduce((s, c) => s + (c.totalArs ?? 0), 0);
    ["", "", "", "", "", subtUsd, subtArs].forEach((v, i) => {
      const cell = ws.getCell(fila, i + 1);
      cell.value = i === 2 ? `Subtotal ${ETIQUETA_TIPO[tipo]}` : (v as ExcelJS.CellValue);
      cell.font = { bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBAR_CLARO } };
    });
    fila++;
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cantera_informe_${desde}_a_${hasta}.xlsx"`,
    },
  });
}
