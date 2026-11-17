// Una sola vez: terminar de cargar la OT 2983, que nació a medias.
//
// QUÉ LE PASÓ. La generación del cuaderno de PIPARO del 03/11/2026 le escribió
// el alta en la planilla a las 14:08:21 y algo se cortó antes de guardar lo que
// va de la K en adelante. La fila existe en «Altas del sistema» y en el master,
// y la sincronización de las 14:44 la trajo a `ordenes_trabajo` — pero con lo
// único que la planilla tenía: descripción, sector, equipo y prioridad.
//
// Comparada con sus 47 hermanas, le faltan exactamente cuatro campos:
//
//     fecha_cierre  null       → 2026-10-21
//     estado        POR_HACER  → REALIZADO
//     contratista   null       → PIPARO
//     horas         null       → 28
//
// Los cuatro salen de su único renglón —línea 11, «Pasar 1400 barras/cuadrados
// rompedores», del 07/10 al 21/10, 28 h—, que es el mismo lugar del que los
// habría sacado la generación.
//
// LO QUE NO SE TOCA. `fecha` dice 2026-11-03 y así se queda: **las 48 dicen lo
// mismo**, porque la sincronización la trae de la marca temporal (columna B del
// master, que es derrame de la hoja de respuestas). Corregirla sólo en ésta la
// dejaría distinta de sus hermanas y la próxima sincronización la volvería a
// pisar igual.
//
// Después de la base, las columnas K/M/N/O del master se escriben por el mismo
// camino que todo lo demás: `loQueHayQueExportar` → `celdasParaRegistrar` →
// `escribirEnLaFilaDeLaOT`. Nada de esto inventa una ruta nueva.
//
// Sin `--escribir` no toca nada.

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loQueHayQueExportar } from "../lib/mantenimiento/cierreDeOT.ts";
import { celdasParaRegistrar, type RegistroDeOT } from "../lib/mantenimiento/ordenes.ts";
import { escribirEnLaFilaDeLaOT } from "../lib/mantenimiento/planillaDeOT.ts";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const ESCRIBIR = process.argv.includes("--escribir");
const OT = 2983;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const { data: orden } = await db
  .from("ordenes_trabajo")
  .select("id, ot_number, descripcion, fecha, fecha_cierre, fecha_ejecucion, estado, contratista, horas, costo, repuesto, sheets_pendiente")
  .eq("ot_number", OT)
  .maybeSingle();
if (!orden) { console.log(`La OT ${OT} no está en ordenes_trabajo. No hay nada que completar.`); process.exit(1); }

const { data: renglones } = await db
  .from("mant_cuadernos_renglones")
  .select("id, linea, fecha, fecha_hasta, tarea, horas, costo")
  .eq("orden_trabajo_id", orden.id as string)
  .order("linea");
if ((renglones ?? []).length === 0) {
  console.log(`La OT ${OT} no tiene ningún renglón del cuaderno. Sin eso no hay de dónde sacar las horas ni el cierre.`);
  process.exit(1);
}

// La salvaguarda: que el trabajo de esta orden no esté además en otra. Si lo
// estuviera, completarla sería darle dos órdenes a lo mismo —y a PIPARO se le
// paga por esto—.
const { data: gemelas } = await db
  .from("ordenes_trabajo")
  .select("ot_number")
  .eq("descripcion", orden.descripcion as string)
  .neq("ot_number", OT);
if ((gemelas ?? []).length > 0) {
  console.log(`CUIDADO: hay otra orden con la misma descripción (OT ${(gemelas ?? []).map((g) => g.ot_number).join(", ")}). No se completa nada: habría que mirar si es la misma tarea.`);
  process.exit(1);
}

const horas = (renglones ?? []).reduce((s, r) => s + (Number(r.horas) || 0), 0);
const fechas = (renglones ?? []).flatMap((r) => [r.fecha, r.fecha_hasta]).filter(Boolean).sort() as string[];
const cierre = fechas[fechas.length - 1] ?? null;

const cambios = {
  fecha_cierre: cierre,
  estado: "REALIZADO",
  contratista: "PIPARO",
  horas,
};

console.log(`OT ${OT} — «${orden.descripcion}»`);
console.log(`  su renglón: línea ${renglones![0].linea} · ${renglones![0].fecha} al ${renglones![0].fecha_hasta} · ${renglones![0].horas} h`);
console.log(`  no hay otra orden con la misma descripción: no se duplica nada\n`);
console.log(`  campo          ahora dice      va a decir`);
for (const [k, v] of Object.entries(cambios)) {
  console.log(`  ${k.padEnd(14)} ${String((orden as Record<string, unknown>)[k]).padEnd(15)} ${String(v)}`);
}
console.log(`  fecha          ${orden.fecha}      (NO se toca: las 48 dicen lo mismo)`);

if (!ESCRIBIR) {
  console.log(`\nEn seco. Para escribir: npx tsx scripts/cargar-a-mano-la-ot-2983.mts --escribir`);
  process.exit(0);
}

console.log(`\n=== ESCRIBIENDO ===`);
const { data: guardada, error } = await db
  .from("ordenes_trabajo").update(cambios).eq("id", orden.id as string).select().single();
if (error) { console.log(`  la base no se pudo actualizar: ${error.message}`); process.exit(1); }
console.log(`  base: cierre ${guardada.fecha_cierre} · estado ${guardada.estado} · contratista ${guardada.contratista} · ${guardada.horas} h`);

const registro = loQueHayQueExportar(guardada);
if (!registro) { console.log(`  no hay nada que exportar, lo que sería un error: se corta acá.`); process.exit(1); }
const fallo = await escribirEnLaFilaDeLaOT(guardada, celdasParaRegistrar(registro as RegistroDeOT));
await db
  .from("ordenes_trabajo")
  .update({ sheets_pendiente: fallo, sheets_intentado_en: new Date().toISOString() })
  .eq("id", orden.id as string);
console.log(`  master: ${fallo ?? "K/M/N/O escritas"}`);
