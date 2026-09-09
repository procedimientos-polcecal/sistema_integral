// Compara la planilla `ORDENES DE CARGA - Detalle` contra
// `despacho_ordenes_carga`, y muestra en qué difieren.
//
// Hace falta porque el importador es idempotente por `numero`
// (`ignoreDuplicates`): una fila que se corrige **en la planilla después** de
// importarla no vuelve a entrar, así que la base se queda con el valor viejo y
// nada avisa.
//
// De acá en más manda el sistema y la planilla es un espejo de una sola vía, o
// sea que esto no es una sincronización: es la herramienta para el momento en
// que todavía se está acomodando el histórico.
//
// Uso:
//   npx tsx scripts/comparar-despacho.mts             # sólo informa
//   npx tsx scripts/comparar-despacho.mts --corregir  # pisa la base con la planilla
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { leerValores, listarPestanas } from "../lib/core/sheets.ts";
import { ordenesDeLaPlanilla } from "../lib/despacho/importar.ts";
import { pestanaDelMes } from "../lib/despacho/planilla.ts";
import { traerTodo } from "../lib/core/paginado.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const LIBRO =
  process.env.GOOGLE_SHEETS_DESPACHO_ID || "1jF2lqDn_9H_BRQ8TQFNopfappOPyMGCQwFsGkWSkonM";
const corregir = process.argv.includes("--corregir");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

/** Los campos que el importador trae de la planilla, y por lo tanto los que se comparan. */
const CAMPOS = [
  "fecha",
  "cliente_raw",
  "producto_raw",
  "entrada_predio",
  "inicio_carga",
  "fin_carga",
  "salida_predio",
  "notas",
] as const;

// ── La planilla ──────────────────────────────────────────────
const delLibro = new Map<string, Record<string, unknown> & { fila: number; pestana: string }>();
for (const pestana of await listarPestanas(LIBRO)) {
  const { ordenes } = ordenesDeLaPlanilla(await leerValores(LIBRO, pestana, { sinFormato: true }));
  for (const o of ordenes) {
    // El primero gana, igual que en el importador: un Nº repetido es un error
    // de tipeo y no dos órdenes.
    if (!delLibro.has(o.numero)) delLibro.set(o.numero, { ...o, pestana });
  }
}

// ── La base ──────────────────────────────────────────────────
const enLaBase = await traerTodo<Record<string, unknown>>((desde, hasta) =>
  sb
    .from("despacho_ordenes_carga")
    .select(
      "id, numero, fecha, cliente_raw, producto_raw, entrada_predio, inicio_carga, fin_carga, salida_predio, notas, cargado_por, sheets_fila"
    )
    .range(desde, hasta)
);

console.log(`planilla: ${delLibro.size} órdenes · base: ${enLaBase.length} órdenes\n`);

/** Un timestamp de la base llega con `+00:00`; el de la planilla, con `Z`. */
const mismo = (a: unknown, b: unknown) => {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === "string" && typeof b === "string") {
    const ta = Date.parse(a), tb = Date.parse(b);
    if (!isNaN(ta) && !isNaN(tb)) return ta === tb;
  }
  return false;
};

const distintas: { id: string; numero: string; cambios: Record<string, unknown>; detalle: string[] }[] = [];
const soloEnLaBase: string[] = [];
const soloEnLaPlanilla: string[] = [];

for (const fila of enLaBase) {
  const numero = String(fila.numero);
  const libro = delLibro.get(numero);
  if (!libro) { soloEnLaBase.push(numero); continue; }

  const cambios: Record<string, unknown> = {};
  const detalle: string[] = [];
  for (const campo of CAMPOS) {
    if (!mismo(fila[campo], libro[campo])) {
      cambios[campo] = libro[campo];
      detalle.push(`${campo}: base=${JSON.stringify(fila[campo])} → planilla=${JSON.stringify(libro[campo])}`);
    }
  }

  // La fila de la planilla también puede haberse movido, y si se guardó la
  // vieja una corrección reescribiría el renglón de otra orden.
  const filaBuena = pestanaDelMes(String(libro.fecha)) === libro.pestana ? libro.fila : null;
  if (fila.sheets_fila !== filaBuena) {
    cambios.sheets_fila = filaBuena;
    detalle.push(`sheets_fila: base=${JSON.stringify(fila.sheets_fila)} → ${JSON.stringify(filaBuena)}`);
  }

  if (detalle.length) distintas.push({ id: String(fila.id), numero, cambios, detalle });
}

for (const numero of delLibro.keys()) {
  if (!enLaBase.some((f) => String(f.numero) === numero)) soloEnLaPlanilla.push(numero);
}

if (soloEnLaPlanilla.length) {
  console.log(`En la planilla y no en la base (${soloEnLaPlanilla.length}): ${soloEnLaPlanilla.join(", ")}`);
  console.log("  → correr scripts/importar-despacho.mts --escribir\n");
}
if (soloEnLaBase.length) {
  console.log(`En la base y no en la planilla (${soloEnLaBase.length}): ${soloEnLaBase.join(", ")}`);
  console.log("  → normal si ya se cargan órdenes desde la balanza y todavía no se cerraron\n");
}

if (distintas.length === 0) {
  console.log("La base y la planilla dicen lo mismo en las órdenes que comparten.");
  process.exit(0);
}

console.log(`Difieren ${distintas.length} órdenes:`);
for (const d of distintas) {
  console.log(`\n  Nº ${d.numero}`);
  for (const l of d.detalle) console.log(`    ${l}`);
}

if (!corregir) {
  console.log("\nNo se cambió nada. Para pisar la base con la planilla, --corregir");
  process.exit(0);
}

for (const d of distintas) {
  const { error } = await sb.from("despacho_ordenes_carga").update(d.cambios).eq("id", d.id);
  if (error) { console.error(`  Nº ${d.numero}: ${error.message}`); process.exit(1); }
  console.log(`  Nº ${d.numero}: corregida`);
}
console.log(`\n${distintas.length} corregidas.`);
