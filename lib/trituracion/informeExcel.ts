/**
 * El libro .xlsx del informe mensual de plantas de trituración, **con
 * fórmulas**: la hoja "Partes" lleva una fila por parte cargado (los datos
 * crudos) y la hoja "Informe" calcula cada número con `SUMIFS`/`COUNTIFS`
 * sobre esa hoja, así que quien lo abre ve de dónde sale cada cifra y puede
 * corregir un parte y ver el informe recalcularse.
 *
 * Las cuentas son las de `informeMensualPorPlanta` (ver ese archivo para el
 * porqué de "horas teóricas = días operativos × 8" y de las tres cifras que
 * no coinciden con la planilla manual). Cada fórmula se escribe junto con su
 * **resultado ya calculado** en JS: Excel lo recalcula al abrir, pero un
 * visor que no calcula (vista previa del celular o del correo, Drive) muestra
 * el valor en vez de una celda vacía. El test comprueba que las dos cosas
 * digan lo mismo.
 */

import ExcelJS from "exceljs";
import {
  horasDelMes,
  informeMensualPorPlanta,
  toneladasPorOrigen,
  type InformeMensualPlanta,
  type ParteParaInformeMensual,
} from "./informeMensual";

const VERDE = "FF1E7D34";
const VERDE_CLARO = "FFF0F8F5";
const AMBAR = "FFB45309";
const AMBAR_CLARO = "FFFFF7ED";
const BLANCO = "FFFFFFFF";
const GRIS = "FF64748B";

const FMT_HORAS = "0.0";
const FMT_TN = "#,##0.0";
const FMT_PCT = "0.0%";
const FMT_RATIO = "0.00";
const FMT_ENTERO = "0";

/** Primera fila de datos en "Partes" (la 1 es el encabezado). */
const PRIMERA = 2;

export interface PlantaParaInforme {
  nombre: string;
  partes: ParteParaInformeMensual[];
}

type Valor = ExcelJS.CellValue;

/** Una fórmula con su resultado precalculado; `null` (sin dato) es celda vacía, igual que en pantalla. */
function f(formula: string, resultado: number | null): ExcelJS.CellFormulaValue {
  return { formula, result: resultado ?? "" };
}

function relleno(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

function tituloSeccion(ws: ExcelJS.Worksheet, fila: number, texto: string, color: string, ancho: number) {
  ws.mergeCells(fila, 1, fila, ancho);
  const c = ws.getCell(fila, 1);
  c.value = texto;
  c.font = { bold: true, color: { argb: BLANCO }, size: 11 };
  for (let col = 1; col <= ancho; col++) ws.getCell(fila, col).fill = relleno(color);
}

function filaEncabezado(ws: ExcelJS.Worksheet, fila: number, columnas: string[], color: string) {
  columnas.forEach((texto, i) => {
    const c = ws.getCell(fila, i + 1);
    c.value = texto;
    c.font = { bold: true, color: { argb: BLANCO } };
    c.fill = relleno(color);
    c.alignment = { wrapText: true, vertical: "middle" };
  });
}

/** `formatos[i]` es el formato numérico de la columna i (la 0 es la etiqueta, sin formato). */
function filaDatos(ws: ExcelJS.Worksheet, fila: number, valores: Valor[], indice: number, claro: string, formatos: (string | null)[]) {
  valores.forEach((v, i) => {
    const c = ws.getCell(fila, i + 1);
    c.value = v;
    if (formatos[i]) c.numFmt = formatos[i]!;
    if (indice % 2 === 1) c.fill = relleno(claro);
  });
}

function filaTotales(ws: ExcelJS.Worksheet, fila: number, valores: Valor[], color: string, formatos: (string | null)[]) {
  valores.forEach((v, i) => {
    const c = ws.getCell(fila, i + 1);
    c.value = v;
    if (formatos[i]) c.numFmt = formatos[i]!;
    c.font = { bold: true, color: { argb: BLANCO } };
    c.fill = relleno(color);
  });
}

/** Letra de columna de Excel (1 → A). */
function letra(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function dividir(a: number, b: number): number | null {
  return b > 0 ? a / b : null;
}

export function armarLibroInforme(mes: string, plantas: PlantaParaInforme[], generado: string): ExcelJS.Workbook {
  const nP = plantas.length;
  const nombres = plantas.map((p) => p.nombre.toUpperCase());
  const informes: InformeMensualPlanta[] = plantas.map((p) => informeMensualPorPlanta(p.partes, mes));
  const todos = plantas.flatMap((p) => p.partes);
  const origenes = toneladasPorOrigen(todos);

  const suma = (g: (i: InformeMensualPlanta) => number) => informes.reduce((s, i) => s + g(i), 0);
  const cons = {
    dias: suma((i) => i.diasOperativos),
    teoricas: suma((i) => i.horasTeoricas),
    reales: suma((i) => i.horasReales),
    viajes: suma((i) => i.viajes),
    toneladas: suma((i) => i.toneladas),
    falta: suma((i) => i.horasFaltaPiedra),
    mant: suma((i) => i.horasMantenimiento),
    varios: suma((i) => i.horasVarios),
    dolomita: suma((i) => i.porMaterial.dolomita),
    chocolata: suma((i) => i.porMaterial.chocolata),
    caliza: suma((i) => i.porMaterial.caliza),
    sinClasificar: suma((i) => i.porMaterial.sinClasificar),
    total: suma((i) => i.porMaterial.total),
  };

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Informe", { views: [{ state: "frozen", ySplit: 2 }] });
  const wp = wb.addWorksheet("Partes", { views: [{ state: "frozen", ySplit: 1 }] });
  const wc = wb.addWorksheet("Cómo se calcula");

  // ───────────────────────── Hoja "Partes": los datos crudos ─────────────────────────
  const COLS_PARTES = ["Planta", "Fecha", "Estado", "Material", "Origen", "Mantenimiento (h)", "Falta de piedra (h)", "Producción (h)", "Otro (h)", "Camiones llegados", "Toneladas procesadas", "Cuenta como día operativo"];
  filaEncabezado(wp, 1, COLS_PARTES, VERDE);
  wp.columns = [14, 12, 10, 14, 16, 14, 14, 14, 10, 12, 14, 16].map((width) => ({ width }));

  const vistos = new Set<string>();
  let fila = PRIMERA;
  plantas.forEach((planta, pi) => {
    const partes = [...planta.partes].sort((a, b) => a.fecha.localeCompare(b.fecha));
    for (const p of partes) {
      const opero = p.estado === "opero";
      const clave = `${pi}|${p.fecha}`;
      const cuenta = opero && !vistos.has(clave) ? 1 : 0;
      if (opero) vistos.add(clave);

      wp.getCell(fila, 1).value = nombres[pi];
      const cFecha = wp.getCell(fila, 2);
      cFecha.value = new Date(`${p.fecha}T00:00:00Z`);
      cFecha.numFmt = "dd/mm/yyyy";
      wp.getCell(fila, 3).value = opero ? "Operó" : "No operó";
      wp.getCell(fila, 4).value = p.material;
      wp.getCell(fila, 5).value = p.origen;
      const numericos: [number, number | null, string][] = [
        [6, p.horasMantenimiento, FMT_HORAS],
        [7, p.horasFaltaPiedra, FMT_HORAS],
        [8, p.horasProduccion, FMT_HORAS],
        [9, p.horasOtro, FMT_HORAS],
        [10, p.camionesLlegados, FMT_ENTERO],
        [11, p.toneladasProcesadas, FMT_TN],
      ];
      for (const [col, valor, fmt] of numericos) {
        const c = wp.getCell(fila, col);
        c.value = valor;
        c.numFmt = fmt;
      }
      // Un día con dos turnos es UN día operativo: sólo la primera fila operativa de cada
      // planta+fecha vale 1, y "Días operativos" del informe es la suma de esta columna.
      wp.getCell(fila, 12).value = f(
        `IF(AND(C${fila}="Operó",COUNTIFS($A$${PRIMERA}:A${fila},A${fila},$B$${PRIMERA}:B${fila},B${fila},$C$${PRIMERA}:C${fila},"Operó")=1),1,0)`,
        cuenta
      );
      fila++;
    }
  });
  const ULTIMA = Math.max(fila - 1, PRIMERA);
  const rng = (col: string) => `Partes!$${col}$${PRIMERA}:$${col}$${ULTIMA}`;
  const sumifsOp = (colSuma: string, planta: string) =>
    `SUMIFS(${rng(colSuma)},${rng("A")},${planta},${rng("C")},"Operó")`;

  // ───────────────────────── Hoja "Informe" ─────────────────────────
  const ANCHO = Math.max(7, nP + 1);
  ws.columns = Array.from({ length: ANCHO }, (_, i) => ({ width: i === 0 ? 34 : 18 }));

  ws.mergeCells(1, 1, 1, ANCHO);
  ws.getCell(1, 1).value = `INFORME DE PLANTAS DE TRITURACIÓN — ${mes}`;
  ws.getCell(1, 1).font = { bold: true, color: { argb: BLANCO }, size: 13 };
  for (let c = 1; c <= ANCHO; c++) ws.getCell(1, c).fill = relleno(VERDE);

  ws.mergeCells(2, 1, 2, ANCHO);
  ws.getCell(2, 1).value = `Generado: ${generado} — todas las cifras son fórmulas sobre la hoja "Partes"; la hoja "Cómo se calcula" explica cada una.`;
  ws.getCell(2, 1).font = { italic: true, size: 9, color: { argb: GRIS } };
  for (let c = 1; c <= ANCHO; c++) ws.getCell(2, c).fill = relleno(VERDE_CLARO);

  // Parámetros: lo que la cuenta supone, a la vista y editable.
  const F_MES = 4;
  const F_HS_DIA = 5;
  const F_HS_MES = 6;
  const horasMes = horasDelMes(mes);
  ws.getCell(F_MES, 1).value = "Primer día del mes";
  ws.getCell(F_MES, 2).value = new Date(`${mes}-01T00:00:00Z`);
  ws.getCell(F_MES, 2).numFmt = "dd/mm/yyyy";
  ws.getCell(F_HS_DIA, 1).value = "Horas teóricas por día operativo";
  ws.getCell(F_HS_DIA, 2).value = 8;
  ws.getCell(F_HS_MES, 1).value = "Horas del mes (días × 24)";
  ws.getCell(F_HS_MES, 2).value = f(`DAY(EOMONTH(B${F_MES},0))*24`, horasMes);
  for (const r of [F_MES, F_HS_DIA, F_HS_MES]) {
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 2).alignment = { horizontal: "right" };
  }
  ws.getCell(F_HS_DIA, 2).fill = relleno("FFFEF9C3"); // el único valor que se puede mover a mano
  const HS_DIA = `$B$${F_HS_DIA}`;
  const HS_MES = `$B$${F_HS_MES}`;

  // Dónde cae cada tabla: la Tabla 1 apunta a la 2, 3 y 4, así que las filas se fijan antes de escribir.
  const r1 = 8;
  const r2 = r1 + 9; // título + encabezado + 6 indicadores + 1 de aire
  const r3 = r2 + nP + 4; // título + encabezado + plantas + consolidado + 1 de aire
  const r4 = r3 + nP + 4;
  const r5 = r4 + nP + 3; // sin consolidado
  const r6 = r5 + nP + 4;
  const fPlanta2 = (i: number) => r2 + 2 + i;
  const fPlanta3 = (i: number) => r3 + 2 + i;
  const fCons2 = r2 + 2 + nP;
  const fCons3 = r3 + 2 + nP;

  // ── Tabla N°1 — KPIs por planta (plantas en columnas) ──
  tituloSeccion(ws, r1, "▸ TABLA N°1 — KPIs OPERACIONALES POR PLANTA", VERDE, ANCHO);
  filaEncabezado(ws, r1 + 1, ["Indicador", ...nombres], VERDE);
  const kpis: { etiqueta: string; fmt: string; formula: (i: number) => string; resultado: (inf: InformeMensualPlanta) => number | null }[] = [
    { etiqueta: "Productividad media (t/h marcha)", fmt: FMT_RATIO, formula: (i) => `G${fPlanta2(i)}`, resultado: (x) => x.productividadTHMarcha },
    { etiqueta: "Toneladas por viaje", fmt: FMT_RATIO, formula: (i) => `IF(E${fPlanta2(i)}>0,F${fPlanta2(i)}/E${fPlanta2(i)},"")`, resultado: (x) => x.toneladasPorViaje },
    { etiqueta: "Horas perdidas totales", fmt: FMT_HORAS, formula: (i) => `SUM(B${fPlanta3(i)}:D${fPlanta3(i)})`, resultado: (x) => x.horasPerdidasTotal },
    { etiqueta: "% horas perdidas s/ teóricas", fmt: FMT_PCT, formula: (i) => `IF(C${fPlanta2(i)}>0,${letra(i + 2)}${r1 + 4}/C${fPlanta2(i)},"")`, resultado: (x) => x.pctHorasPerdidas },
    { etiqueta: "Días operativos", fmt: FMT_ENTERO, formula: (i) => `B${fPlanta2(i)}`, resultado: (x) => x.diasOperativos },
    { etiqueta: "Días con falta de piedra", fmt: FMT_ENTERO, formula: (i) => `COUNTIFS(${rng("A")},$A${fPlanta2(i)},${rng("C")},"Operó",${rng("G")},">0")`, resultado: (x) => x.diasConFaltaPiedra },
  ];
  kpis.forEach((k, ki) => {
    filaDatos(ws, r1 + 2 + ki, [k.etiqueta, ...informes.map((inf, i) => f(k.formula(i), k.resultado(inf)))], ki, VERDE_CLARO, [null, ...informes.map(() => k.fmt)]);
  });

  // ── Tabla N°2 — Datos operativos por planta ──
  tituloSeccion(ws, r2, "▸ TABLA N°2 — DATOS OPERATIVOS POR PLANTA", AMBAR, ANCHO);
  filaEncabezado(ws, r2 + 1, ["Planta", "Días operativos", "Hs teór.", "Hs reales", "Viajes", "Toneladas", "Producción (Tn/h)"], AMBAR);
  const fmt2 = [null, FMT_ENTERO, FMT_HORAS, FMT_HORAS, FMT_ENTERO, FMT_TN, FMT_RATIO];
  informes.forEach((inf, i) => {
    const r = fPlanta2(i);
    filaDatos(ws, r, [
      nombres[i],
      f(`SUMIFS(${rng("L")},${rng("A")},$A${r})`, inf.diasOperativos),
      f(`B${r}*${HS_DIA}`, inf.horasTeoricas),
      f(`C${r}-SUM(B${fPlanta3(i)}:D${fPlanta3(i)})`, inf.horasReales),
      f(sumifsOp("J", `$A${r}`), inf.viajes),
      f(sumifsOp("K", `$A${r}`), inf.toneladas),
      f(`IF(D${r}>0,F${r}/D${r},"")`, inf.productividadTHMarcha),
    ], i, AMBAR_CLARO, fmt2);
  });
  const a2 = fPlanta2(0);
  const z2 = fPlanta2(nP - 1);
  const sumaCol = (col: string, a: number, z: number) => `SUM(${col}${a}:${col}${z})`;
  filaTotales(ws, fCons2, [
    "CONSOLIDADO",
    f(sumaCol("B", a2, z2), cons.dias),
    f(sumaCol("C", a2, z2), cons.teoricas),
    f(sumaCol("D", a2, z2), cons.reales),
    f(sumaCol("E", a2, z2), cons.viajes),
    f(sumaCol("F", a2, z2), cons.toneladas),
    f(`IF(D${fCons2}>0,F${fCons2}/D${fCons2},"")`, dividir(cons.toneladas, cons.reales)),
  ], AMBAR, fmt2);

  // ── Tabla N°3 — Horas improductivas por causa ──
  tituloSeccion(ws, r3, "▸ TABLA N°3 — HORAS IMPRODUCTIVAS POR CAUSA", VERDE, ANCHO);
  filaEncabezado(ws, r3 + 1, ["Planta", "Falta de piedra (hs)", "Mantenimiento (hs)", "Varios (hs)"], VERDE);
  const fmt3 = [null, FMT_HORAS, FMT_HORAS, FMT_HORAS];
  informes.forEach((inf, i) => {
    const r = fPlanta3(i);
    filaDatos(ws, r, [
      nombres[i],
      f(sumifsOp("G", `$A${r}`), inf.horasFaltaPiedra),
      f(sumifsOp("F", `$A${r}`), inf.horasMantenimiento),
      // La planilla junta Producción y Otro bajo "Varios".
      f(`${sumifsOp("H", `$A${r}`)}+${sumifsOp("I", `$A${r}`)}`, inf.horasVarios),
    ], i, VERDE_CLARO, fmt3);
  });
  const a3 = fPlanta3(0);
  const z3 = fPlanta3(nP - 1);
  filaTotales(ws, fCons3, [
    "CONSOLIDADO",
    f(sumaCol("B", a3, z3), cons.falta),
    f(sumaCol("C", a3, z3), cons.mant),
    f(sumaCol("D", a3, z3), cons.varios),
  ], VERDE, fmt3);

  // ── Tabla N°4 — Coeficientes de gestión del tiempo ──
  tituloSeccion(ws, r4, "▸ TABLA N°4 — COEFICIENTES DE GESTIÓN DEL TIEMPO", AMBAR, ANCHO);
  filaEncabezado(ws, r4 + 1, ["Planta", "Disponibilidad", "Utilización", "Dirección", "Falta de piedra (%)", "Mantenimiento (%)", "Varios (%)"], AMBAR);
  const fmt4 = [null, FMT_PCT, FMT_PCT, FMT_PCT, FMT_PCT, FMT_PCT, FMT_PCT];
  informes.forEach((inf, i) => {
    const t2 = fPlanta2(i);
    const t3 = fPlanta3(i);
    const sobreTeoricas = (celda: string) => `IF(C${t2}>0,${celda}/C${t2},"")`;
    filaDatos(ws, r4 + 2 + i, [
      nombres[i],
      // La falta de piedra no resta disponibilidad: no es un fallo de la planta.
      f(`IF(C${t2}>0,(C${t2}-C${t3}-D${t3})/C${t2},"")`, inf.disponibilidad),
      f(sobreTeoricas(`D${t2}`), inf.utilizacion),
      f(`IF(${HS_MES}>0,C${t2}/${HS_MES},"")`, inf.direccion),
      f(sobreTeoricas(`B${t3}`), inf.pctFaltaPiedra),
      f(sobreTeoricas(`C${t3}`), inf.pctMantenimiento),
      f(sobreTeoricas(`D${t3}`), inf.pctVarios),
    ], i, AMBAR_CLARO, fmt4);
  });

  // ── Tabla N°5 — Toneladas procesadas por material ──
  // "Sin clasificar" va siempre: si se corrige un material en "Partes", el total tiene que seguir cerrando.
  tituloSeccion(ws, r5, "▸ TABLA N°5 — TONELADAS PROCESADAS POR MATERIAL", VERDE, ANCHO);
  filaEncabezado(ws, r5 + 1, ["Planta", "Dolomita", "Chocolata", "Caliza", "Sin clasificar", "Total Procesado (Tn)"], VERDE);
  const fmt5 = [null, FMT_TN, FMT_TN, FMT_TN, FMT_TN, FMT_TN];
  const porMaterial = (r: number, material: string) =>
    `SUMIFS(${rng("K")},${rng("A")},$A${r},${rng("C")},"Operó",${rng("D")},"${material}")`;
  informes.forEach((inf, i) => {
    const r = r5 + 2 + i;
    filaDatos(ws, r, [
      nombres[i],
      f(porMaterial(r, "Dolomita"), inf.porMaterial.dolomita),
      f(porMaterial(r, "Chocolata"), inf.porMaterial.chocolata),
      f(porMaterial(r, "Caliza"), inf.porMaterial.caliza),
      f(`F${r}-SUM(B${r}:D${r})`, inf.porMaterial.sinClasificar),
      f(sumifsOp("K", `$A${r}`), inf.porMaterial.total),
    ], i, VERDE_CLARO, fmt5);
  });
  const fCons5 = r5 + 2 + nP;
  filaTotales(ws, fCons5, [
    "CONSOLIDADO",
    f(sumaCol("B", r5 + 2, fCons5 - 1), cons.dolomita),
    f(sumaCol("C", r5 + 2, fCons5 - 1), cons.chocolata),
    f(sumaCol("D", r5 + 2, fCons5 - 1), cons.caliza),
    f(sumaCol("E", r5 + 2, fCons5 - 1), cons.sinClasificar),
    f(sumaCol("F", r5 + 2, fCons5 - 1), cons.total),
  ], VERDE, fmt5);

  // ── Tabla N°6 — Toneladas acarreadas por cantera ──
  // La lista de orígenes sale de los datos al armar el archivo; si se carga un origen nuevo en
  // "Partes" hay que agregarle su fila acá (el total de abajo suma las filas que haya).
  tituloSeccion(ws, r6, "▸ TABLA N°6 — TONELADAS ACARREADAS POR CANTERA", AMBAR, ANCHO);
  filaEncabezado(ws, r6 + 1, ["Cantera", "Toneladas"], AMBAR);
  origenes.forEach((o, i) => {
    const r = r6 + 2 + i;
    filaDatos(ws, r, [
      o.origen,
      f(`SUMIFS(${rng("K")},${rng("E")},$A${r},${rng("C")},"Operó")`, o.toneladas),
    ], i, AMBAR_CLARO, [null, FMT_TN]);
  });
  if (origenes.length > 0) {
    const fTot = r6 + 2 + origenes.length;
    filaTotales(ws, fTot, [
      "TOTAL",
      f(sumaCol("B", r6 + 2, fTot - 1), origenes.reduce((s, o) => s + o.toneladas, 0)),
    ], AMBAR, [null, FMT_TN]);
  }

  // ───────────────────────── Hoja "Cómo se calcula" ─────────────────────────
  wc.columns = [{ width: 34 }, { width: 110 }];
  filaEncabezado(wc, 1, ["Cifra", "Cómo se calcula"], VERDE);
  const explicaciones: [string, string][] = [
    ["Días operativos", "Cantidad de fechas distintas con al menos un parte \"Operó\" en esa planta. Un día con dos turnos cuenta uno: por eso la hoja Partes tiene la columna \"Cuenta como día operativo\" (1 sólo en la primera fila operativa de cada planta y fecha) y el informe la suma."],
    ["Hs teóricas", "Días operativos × horas por día operativo (celda B5, 8). Es la definición de la planilla manual, no la suma de hora inicio → hora fin de cada parte que usan las otras pantallas de Trituración: por eso no van a coincidir con ellas."],
    ["Hs reales", "Hs teóricas − (falta de piedra + mantenimiento + varios). Es la única cuenta que se puede reproducir: la planilla manual suma rangos de celdas elegidos a mano, y por eso Utilización, Productividad y Tn/h pueden diferir de ella unos puntos."],
    ["Varios (hs)", "Horas de Producción + horas de Otro, de los partes \"Operó\"."],
    ["Horas perdidas totales", "Falta de piedra + Mantenimiento + Varios."],
    ["Viajes / Toneladas", "Suma de camiones llegados / toneladas procesadas de los partes \"Operó\"."],
    ["Producción (Tn/h) y Productividad media", "Toneladas ÷ Hs reales. Es el mismo número en las tablas 1 y 2."],
    ["Toneladas por viaje", "Toneladas ÷ Viajes."],
    ["% horas perdidas", "Horas perdidas totales ÷ Hs teóricas."],
    ["Días con falta de piedra", "Cantidad de partes \"Operó\" con horas de falta de piedra mayores a 0. Cuenta filas, no fechas: un día con dos turnos con falta de piedra en los dos cuenta dos (igual que el COUNTIFS de la planilla)."],
    ["Disponibilidad", "(Hs teóricas − mantenimiento − varios) ÷ Hs teóricas. La falta de piedra no resta: no es un fallo de la planta."],
    ["Utilización", "Hs reales ÷ Hs teóricas."],
    ["Dirección", "Hs teóricas ÷ horas del mes (días del mes × 24, celda B6)."],
    ["Falta de piedra / Mantenimiento / Varios (%)", "Cada causa en horas ÷ Hs teóricas."],
    ["Toneladas por material", "Toneladas de los partes \"Operó\" con ese material. \"Sin clasificar\" es el total menos Dolomita, Chocolata y Caliza: partes sin material o con uno combinado (\"Caliza + Chocolata\", del histórico importado). No se reparte adivinando."],
    ["Toneladas por cantera", "Toneladas de los partes \"Operó\" con ese origen, sumando las tres plantas. Un parte sin origen no entra en ninguna fila. Si se carga un origen nuevo en Partes, hay que agregarle su fila."],
    ["Si se corrige un dato", "Cambiar un valor en la hoja Partes recalcula todo el Informe. Cambiar el 8 de la celda B5 recalcula las horas teóricas."],
  ];
  explicaciones.forEach(([cifra, texto], i) => {
    wc.getCell(i + 2, 1).value = cifra;
    wc.getCell(i + 2, 1).font = { bold: true };
    wc.getCell(i + 2, 1).alignment = { vertical: "top", wrapText: true };
    wc.getCell(i + 2, 2).value = texto;
    wc.getCell(i + 2, 2).alignment = { wrapText: true, vertical: "top" };
  });

  return wb;
}
