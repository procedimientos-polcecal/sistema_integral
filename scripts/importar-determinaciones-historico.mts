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

/**
 * Las tabulares: una fila por día y encabezado en la fila 1.
 *
 * `Calcio` está acá y no en los bloques, aunque el spec la contara entre las
 * sueltas: su fila 1 dice `Fecha | Muestra | Humedad bh (%) | P recipiente (g) |
 * P inicial (g) | P final (g)` y tiene 65 filas con fecha. Leerla como bloques
 * consumía cada fila de datos como encabezado y **perdía 245 valores**, dejando
 * entrar tres cuyo origen era un número suelto. Su columna «Muestra» es el
 * origen de cada fila, igual que «Cliente» en la de despachos.
 *
 * Lo que `Calcio` sigue dejando afuera es su bloque de la derecha —columnas 10
 * en adelante, con fechas por encabezado—, que no es ninguna de las dos formas.
 */
const TABULARES = [
  "Filler 1", "Cal", "Filler 2", "Despacho a Kartonsec", "Despacho a Emapi",
  "Despachos cal fillerizada", "Calcio",
];
/** Las que vienen en bloques: fecha arriba, muestras de costado. */
const EN_BLOQUES = ["Otros", "Separadoras"];

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(ruta);

/**
 * Una celda de exceljs a la forma que el parser entiende.
 *
 * **La fórmula se lee de `c.formula` y no del `value`.** Una celda con fórmula
 * arrastrada llega como `{result, sharedFormula}` **sin** `formula` propia:
 * mirando el `value` cae fuera de todas las ramas, el valor queda siendo el
 * objeto y se descarta en silencio. Son **171 celdas numéricas** del libro,
 * entre ellas las dos columnas de porcentaje enteras de `Despachos cal
 * fillerizada`. El getter `c.formula` traduce la compartida y devuelve la
 * fórmula real, que además es lo que `esAgregacion` necesita para que un
 * `AVERAGE` arrastrado no se cuele.
 */
const aCelda = (c: ExcelJS.Cell): Celda => {
  const formula = (c as unknown as { formula?: string }).formula;
  if (formula !== undefined) {
    return { valor: (c as unknown as { result?: unknown }).result, formula };
  }
  let v: unknown = c.value;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (v instanceof Date) v = v.toISOString().slice(0, 10);
    else if ("richText" in o) v = (o.richText as { text: string }[]).map((t) => t.text).join("");
    else if ("text" in o) v = o.text;
  }
  return { valor: v };
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
linea("valores totales", todas.length, 3685);
linea("fraccion (cinco tabulares)", cuenta("fraccion"), 958);
linea("porcentaje (cinco tabulares)", cuenta("porcentaje"), 1544);
linea("absoluto (cinco tabulares)", cuenta("absoluto"), 585);
linea("filas con revisar", conRevisar, 28);
linea("agregaciones descartadas", agregaciones, 27);
linea("orígenes distintos", origenes.size, 64);
linea("orígenes sin producto", sinProducto.size, 50);
linea("rango desde", fechas[0], "2023-11-06");
linea("rango hasta", fechas[fechas.length - 1], "2026-10-21");

// La clave natural, que es lo que hace repetible la importación.
//
// `(hoja, fila_excel, determinacion, fecha, origen_raw)` es **una celda** del
// Excel: la hoja y la fila la ubican, la determinación es la columna, y las
// otras dos distinguen los bloques, donde una misma fila lleva varias muestras
// de costado. La tabla tiene un unique sobre esas cinco, así que una repetida
// acá es un error del parseo y no de la planilla — y conviene verlo en seco,
// antes de que lo diga Postgres a la mitad de un lote.
const claves = new Map<string, number>();
for (const f of todas) {
  const k = [f.hoja, f.fila_excel, f.determinacion, f.fecha, f.origen_raw].join("|");
  claves.set(k, (claves.get(k) ?? 0) + 1);
}
const repetidas = [...claves].filter(([, n]) => n > 1);
linea("claves repetidas", repetidas.length, 0);
for (const [k, n] of repetidas.slice(0, 5)) console.log(`     ${k} x${n}`);

console.log(`\npor hoja:`);
const porHoja = new Map<string, number>();
for (const f of todas) porHoja.set(f.hoja, (porHoja.get(f.hoja) ?? 0) + 1);
for (const [h, n] of porHoja) console.log(`  ${h.padEnd(28)} ${n}`);

if (seco) {
  console.log("\n--secar: no se escribió nada.");
  process.exit(0);
}

if (repetidas.length > 0) {
  console.error("\nHay claves repetidas: el unique de la tabla las va a rechazar. No se escribió nada.");
  process.exit(1);
}

// ── Escribir ─────────────────────────────────────────────────
//
// Se borra todo antes de insertar, a propósito. Esto importa **un archivo
// entero**, así que correrlo de nuevo tiene que dejar la tabla como la dejaría
// la primera vez: sin el delete, un segundo intento —y hubo varios mientras se
// afinaba el parseo— deja cada valor dos veces y la pantalla se los muestra
// repetidos a quien contesta un reclamo. «CORRE UNA SOLA VEZ» era un comentario,
// no una defensa.
const { count: habia } = await admin
  .from("calidad_historico_determinaciones")
  .select("id", { count: "exact", head: true });
if (habia) {
  console.log(`había ${habia} filas: se borran antes de insertar.`);
  const { error } = await admin
    .from("calidad_historico_determinaciones")
    .delete()
    .not("id", "is", null);
  if (error) { console.error(`No se pudo limpiar: ${error.message}`); process.exit(1); }
}

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
