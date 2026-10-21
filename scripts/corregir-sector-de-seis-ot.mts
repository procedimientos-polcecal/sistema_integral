// Las seis OT que la app escribió con el nombre viejo de su sector.
//
// POR QUÉ
//
// El 19/10/2026 se renombraron ocho sectores para que coincidieran con lo que
// la planilla escribe. Seis órdenes creadas desde el SdG entre el 16 y el 19
// habían quedado con el nombre de ese momento escrito en la celda:
//
//   2796, 2827  "Planta 02"    → Planta 0-2 mm
//   2797, 2825, 2826  "Filler 1"  → Planta filler 1
//   2824  "Molienda cal"       → Molienda de cal
//
// El sector **enlazado** de las seis ya es el correcto —lo resuelve el equipo—,
// así que el filtro, el MTBF y los costos están bien. Lo viejo se ve sólo en la
// etiqueta del renglón del listado, que muestra el texto de la planilla.
//
// DÓNDE SE ESCRIBE, Y DÓNDE NO
//
// **No en el master.** Las columnas A a J de la pestaña `OT` son el derrame de
// cuatro `QUERY(IMPORTRANGE())`: escribir ahí lo rompe con `#REF!`. La celda
// de verdad vive en el libro de respuestas, en una de sus dos pestañas —cuatro
// en `Altas del sistema`, que es donde el SdG escribe sus altas, y dos en
// `Respuestas de formulario`, anteriores a que esa pestaña existiera—.
//
// Corregida la respuesta, el master recalcula solo y la sincronización
// siguiente trae el texto nuevo. Igual se actualiza `sector_raw` en la base
// para que la pantalla no espere quince minutos.
//
// Uso:
//   npx tsx scripts/corregir-sector-de-seis-ot.mts            ← dice qué haría
//   npx tsx scripts/corregir-sector-de-seis-ot.mts --aplicar
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { leerValores, escribirCeldas } = await import("../lib/core/sheets.ts");

const APLICAR = process.argv.includes("--aplicar");
const LIBRO = process.env.GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID ?? "";
if (!LIBRO) throw new Error("Falta GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID");

/**
 * La columna `SECTOR QUE SOLICITA` es la F en las dos pestañas.
 *
 * `escribirCeldas` la quiere como número —resuelve la letra él—, así que van
 * las dos: el 6 para escribir y la letra para que el informe se pueda leer
 * contra la planilla.
 */
const COLUMNA = 6;
const LETRA = "F";
const PESTANAS = ["Altas del sistema", "Respuestas de formulario"];

/** Qué OT hay que corregir y a qué. */
const CORRECCIONES: Record<string, string> = {
  "2796": "Planta 0-2 mm",
  "2797": "Planta filler 1",
  "2824": "Molienda de cal",
  "2825": "Planta filler 1",
  "2826": "Planta filler 1",
  "2827": "Planta 0-2 mm",
};

/* ── Dónde está cada una ────────────────────────────────────────────────── */

type Celda = { ot: string; pestana: string; fila: number; dice: string; va: string };
const celdas: Celda[] = [];
const noEncontradas = new Set(Object.keys(CORRECCIONES));

for (const pestana of PESTANAS) {
  // `leerValores` se niega sola si la planilla está recalculando: en ese estado
  // devuelve unas celdas con "Cargando…" y las demás vacías, y buscar una fila
  // ahí daría el número de otra.
  const filas = await leerValores(LIBRO, pestana, { sinFormato: true });
  for (let i = 1; i < filas.length; i++) {
    const ot = String(filas[i][0] ?? "").trim();
    if (!CORRECCIONES[ot]) continue;
    const dice = String(filas[i][5] ?? "").trim();
    noEncontradas.delete(ot);
    if (dice === CORRECCIONES[ot]) {
      console.log(`  ya estaba  OT ${ot} · ${pestana}!${LETRA}${i + 1} = "${dice}"`);
      continue;
    }
    celdas.push({ ot, pestana, fila: i + 1, dice, va: CORRECCIONES[ot] });
  }
}

for (const c of celdas) {
  console.log(`  corregir   OT ${c.ot} · ${c.pestana}!${LETRA}${c.fila} · "${c.dice}" → "${c.va}"`);
}
if (noEncontradas.size > 0) {
  console.log(`\nNo se encontraron en el libro: ${[...noEncontradas].join(", ")}. No se toca nada de ellas.`);
}

if (celdas.length === 0) {
  console.log("\nNo hay nada que corregir.");
  process.exit(0);
}

if (!APLICAR) {
  console.log(`\nNo se escribió nada. Con --aplicar se corrigen ${celdas.length} celdas y sus filas en la base.`);
  process.exit(0);
}

/* ── Aplicar ────────────────────────────────────────────────────────────── */

// Las seis en una sola llamada: un `batchUpdate` que entra entero o no entra,
// en vez de seis escrituras que podrían quedar a medias.
await escribirCeldas(
  LIBRO,
  celdas.map((c) => ({ pestana: c.pestana, columna: COLUMNA, fila: c.fila, valor: c.va }))
);
for (const c of celdas) console.log(`  ✓ planilla  ${c.pestana}!${LETRA}${c.fila} = "${c.va}"`);

const sb = createAdminClient();
for (const c of celdas) {
  const { error } = await sb
    .from("ordenes_trabajo")
    .update({ sector_raw: c.va })
    .eq("ot_number", Number(c.ot));
  if (error) throw new Error(`actualizando la OT ${c.ot}: ${error.message}`);
  console.log(`  ✓ base      OT ${c.ot} · sector_raw = "${c.va}"`);
}

/* ── Qué quedó ──────────────────────────────────────────────────────────── */

const { data } = await sb
  .from("ordenes_trabajo")
  .select("ot_number, sector_raw")
  .in("ot_number", Object.keys(CORRECCIONES).map(Number))
  .order("ot_number");
console.log("\nEn la base ahora:");
for (const o of data ?? []) console.log(`  OT ${o.ot_number} · ${JSON.stringify(o.sector_raw)}`);
