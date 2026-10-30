// Los tres años de `Determinaciones 2026.xlsx` al libro del SdG.
//
// CORRE UNA SOLA VEZ. El histórico es memoria: lo nuevo se carga en Ensayos, y
// el Excel dejó de alimentarse el 07/10/2026 en las hojas que importan.
//
// NO CONVIERTE NINGÚN NÚMERO. `valor` queda tal como está escrito en la
// planilla y la escala va al lado como etiqueta. El porqué está en el spec: la
// comprobación que justificaría una conversión alcanza a 27 de 362 filas.
//
// Uso:
//   npx tsx scripts/importar-determinaciones-historico.mts --secar <ruta.xlsx>
//   npx tsx scripts/importar-determinaciones-historico.mts <ruta.xlsx>
//
// Spec: docs/superpowers/specs/2026-10-29-calidad-historico-de-determinaciones-design.md
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { createAdminClient } from "../lib/supabase/admin.ts";
import { traerTodo } from "../lib/core/paginado.ts";
import {
  filasDeHojaTabular, filasDeHojaEnBloques, revisarAritmetica, esAgregacion,
} from "../lib/calidad/historico/planilla.ts";
import type { Celda, FilaHistorica } from "../lib/calidad/historico/types.ts";

for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const args = process.argv.slice(2);
const seco = args.includes("--secar");
const ruta = args.find((a) => !a.startsWith("--"));
if (!ruta) {
  console.error("Falta la ruta del .xlsx.");
  process.exit(1);
}

/** Las cinco de una fila por día, más la de despachos, que también es tabular. */
const TABULARES = [
  "Filler 1", "Cal", "Filler 2", "Despacho a Kartonsec", "Despacho a Emapi",
  "Despachos cal fillerizada",
];
/** Las que vienen en bloques: fecha arriba, muestras de costado. */
const EN_BLOQUES = ["Calcio", "Otros", "Separadoras"];

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(ruta);

/** Una celda de exceljs a la forma que el parser entiende. */
const aCelda = (c: ExcelJS.Cell): Celda => {
  let v: unknown = c.value;
  let formula: string | undefined;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (v instanceof Date) v = v.toISOString().slice(0, 10);
    else if ("formula" in o) { formula = String(o.formula); v = o.result; }
    else if ("richText" in o) v = (o.richText as { text: string }[]).map((t) => t.text).join("");
    else if ("text" in o) v = o.text;
  }
  return { valor: v, formula };
};

const filasDe = (ws: ExcelJS.Worksheet, desde: number): Celda[][] => {
  const out: Celda[][] = [];
  for (let n = desde; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    const cs: Celda[] = [];
    for (let i = 1; i <= ws.columnCount; i++) cs.push(aCelda(row.getCell(i)));
    out.push(cs);
  }
  return out;
};

// ── Leer ─────────────────────────────────────────────────────
let todas: FilaHistorica[] = [];
let agregaciones = 0;

for (const ws of wb.worksheets) {
  for (let n = 1; n <= ws.rowCount; n++) {
    for (let i = 1; i <= ws.columnCount; i++) {
      if (esAgregacion(aCelda(ws.getRow(n).getCell(i)))) agregaciones++;
    }
  }
}

for (const nombre of TABULARES) {
  const ws = wb.getWorksheet(nombre);
  if (!ws) { console.error(`Falta la hoja «${nombre}».`); process.exit(1); }
  const enc: string[] = [];
  for (let i = 1; i <= ws.columnCount; i++) {
    enc.push(String(aCelda(ws.getRow(1).getCell(i)).valor ?? "").trim());
  }
  todas = todas.concat(filasDeHojaTabular(nombre, enc, filasDe(ws, 2)));
}

for (const nombre of EN_BLOQUES) {
  const ws = wb.getWorksheet(nombre);
  if (!ws) { console.error(`Falta la hoja «${nombre}».`); process.exit(1); }
  todas = todas.concat(filasDeHojaEnBloques(nombre, filasDe(ws, 1)));
}

// ── Marcar lo que no cierra ──────────────────────────────────
const porFila = new Map<string, FilaHistorica[]>();
for (const f of todas) {
  const k = `${f.hoja}|${f.fila_excel}`;
  porFila.set(k, [...(porFila.get(k) ?? []), f]);
}
let conRevisar = 0;
for (const grupo of porFila.values()) {
  const motivo = revisarAritmetica(grupo);
  if (motivo) { conRevisar++; for (const f of grupo) f.revisar = motivo; }
}

// ── Enlazar al catálogo, por nombre exacto ───────────────────
const admin = createAdminClient();
const productos = await traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
  admin.from("calidad_ensayos_productos").select("id, nombre").range(desde, hasta)
);
const porNombre = new Map(productos.map((p) => [p.nombre, p.id]));

const sinProducto = new Set<string>();
const paraGuardar = todas.map((f) => {
  const producto_id = porNombre.get(f.origen_raw) ?? null;
  if (!producto_id) sinProducto.add(f.origen_raw);
  return { ...f, producto_id };
});

// ── El informe, que es lo que se compara contra el oráculo ───
const cinco = ["Filler 1", "Cal", "Filler 2", "Despacho a Kartonsec", "Despacho a Emapi"];
const tab5 = todas.filter((f) => cinco.includes(f.hoja));
const cuenta = (e: string) => tab5.filter((f) => f.escala === e).length;
const fechas = todas.map((f) => f.fecha).sort();
const origenes = new Set(todas.map((f) => f.origen_raw));

console.log("── Contra el oráculo del spec ──");
const linea = (que: string, dio: unknown, esp: unknown) =>
  console.log(`  ${que.padEnd(40)} ${String(dio).padStart(12)}  esperado ${String(esp).padStart(12)}  ${String(dio) === String(esp) ? "OK" : "<<< NO DA"}`);
linea("valores totales", todas.length, 3304);
linea("fraccion (cinco tabulares)", cuenta("fraccion"), 958);
linea("porcentaje (cinco tabulares)", cuenta("porcentaje"), 1544);
linea("absoluto (cinco tabulares)", cuenta("absoluto"), 585);
linea("filas con revisar", conRevisar, 28);
linea("agregaciones descartadas", agregaciones, 22);
linea("orígenes distintos", origenes.size, 47);
linea("orígenes sin producto", sinProducto.size, 40);
linea("rango desde", fechas[0], "2023-11-06");
linea("rango hasta", fechas[fechas.length - 1], "2026-10-21");

console.log(`\npor hoja:`);
const porHoja = new Map<string, number>();
for (const f of todas) porHoja.set(f.hoja, (porHoja.get(f.hoja) ?? 0) + 1);
for (const [h, n] of porHoja) console.log(`  ${h.padEnd(28)} ${n}`);

if (seco) {
  console.log("\n--secar: no se escribió nada.");
  process.exit(0);
}

// ── Escribir ─────────────────────────────────────────────────
let guardadas = 0;
for (let i = 0; i < paraGuardar.length; i += 500) {
  const lote = paraGuardar.slice(i, i + 500);
  const { error } = await admin.from("calidad_historico_determinaciones").insert(lote);
  if (error) {
    console.error(`\nFalló en el lote que arranca en ${i}: ${error.message}`);
    process.exit(1);
  }
  guardadas += lote.length;
}
console.log(`\nguardadas ${guardadas} filas.`);
