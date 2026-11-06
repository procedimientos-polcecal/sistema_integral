// Devolver a su lugar el equipo de seis OT, y corregir el sector como se debía.
//
// QUÉ PASÓ
//
// `scripts/corregir-sector-de-seis-ot.mts` escribió en la columna **G** —el
// equipo— en vez de la **F** —el sector—, y le puso a cada una el nombre de su
// sector encima del equipo. Las seis quedaron diciendo "EQUIPO: Planta filler 1".
//
// La causa es de una línea: `letraDeColumna()` es **0-based** —su primer
// renglón es `indice + 1`, así que 0 es la A— y el script le pasó un 6
// creyendo que la F era la sexta. 6 es la G. El script hasta tenía una
// constante `LETRA = "F"` al lado para imprimir, así que el informe decía
// `...!F4` mientras la escritura iba a G: lo que se leyó en pantalla no era lo
// que se hizo.
//
// POR QUÉ SE PUEDE ARREGLAR
//
// Porque la base todavía no se enteró. El derrame del master —sus columnas A a
// J son un `QUERY(IMPORTRANGE())` del libro de respuestas— recalculó después
// de la última sincronización, así que `ordenes_trabajo` conserva el
// `equipo_raw` bueno. De ahí salen los valores de abajo, leídos de la base y
// no escritos a mano.
//
// Es una carrera: la sincronización corre cada quince minutos y la próxima
// pisa la base con lo que diga la planilla. Por eso esto va ahora.
//
// Uso:
//   npx tsx scripts/restaurar-equipo-de-seis-ot.mts            ← dice qué haría
//   npx tsx scripts/restaurar-equipo-de-seis-ot.mts --aplicar
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

/*
 * Los índices van 0-based porque así los quiere `letraDeColumna`, que es
 * exactamente lo que el script anterior entendió al revés. Se escriben las dos
 * cosas —el índice y la letra— y se comprueba contra el encabezado antes de
 * tocar nada: una constante que dice "F" al lado de un 6 que significa G es
 * cómo se escribió encima del equipo.
 */
const COL_SECTOR = 5; // F
const COL_EQUIPO = 6; // G

const OTS = [2796, 2797, 2824, 2825, 2826, 2827];

/** El sector como debe quedar; el equipo sale de la base. */
const SECTOR_BUENO: Record<number, string> = {
  2796: "Planta 0-2 mm",
  2797: "Planta filler 1",
  2824: "Molienda de cal",
  2825: "Planta filler 1",
  2826: "Planta filler 1",
  2827: "Planta 0-2 mm",
};

/* ── Lo que la base todavía sabe ────────────────────────────────────────── */

const sb = createAdminClient();
const { data: enLaBase, error } = await sb
  .from("ordenes_trabajo")
  .select("ot_number, equipo_raw, sector_raw")
  .in("ot_number", OTS)
  .order("ot_number");
if (error) throw new Error(error.message);

const equipoBueno = new Map<number, string>();
for (const o of enLaBase ?? []) {
  const eq = String(o.equipo_raw ?? "").trim();
  // Si la base ya se pisó, su `equipo_raw` sería el nombre del sector. En ese
  // caso no hay de dónde sacarlo y es mejor no escribir nada que escribir una
  // suposición encima de la planilla.
  if (!eq || eq === SECTOR_BUENO[o.ot_number]) {
    console.log(`  !! OT ${o.ot_number}: la base ya dice ${JSON.stringify(eq)} — no se toca`);
    continue;
  }
  equipoBueno.set(o.ot_number, eq);
}

/* ── Dónde está cada fila ───────────────────────────────────────────────── */

type Celda = { ot: number; pestana: string; fila: number; sectorDice: string; equipoDice: string };
const celdas: Celda[] = [];

for (const pestana of ["Altas del sistema", "Respuestas de formulario"]) {
  const filas = await leerValores(LIBRO, pestana, { sinFormato: true });
  const enc = filas[0] ?? [];
  // El encabezado se comprueba: si las columnas se movieran, esto tiene que
  // frenar y no escribir en la de al lado. Es el control que faltó.
  if (String(enc[COL_SECTOR] ?? "").toUpperCase() !== "SECTOR QUE SOLICITA") {
    throw new Error(`En "${pestana}" la columna F no es SECTOR QUE SOLICITA sino ${JSON.stringify(enc[COL_SECTOR])}`);
  }
  if (String(enc[COL_EQUIPO] ?? "").toUpperCase() !== "EQUIPO QUE SOLICITA") {
    throw new Error(`En "${pestana}" la columna G no es EQUIPO QUE SOLICITA sino ${JSON.stringify(enc[COL_EQUIPO])}`);
  }

  for (let i = 1; i < filas.length; i++) {
    const ot = Number(String(filas[i][0] ?? "").trim());
    if (!equipoBueno.has(ot)) continue;
    celdas.push({
      ot, pestana, fila: i + 1,
      sectorDice: String(filas[i][COL_SECTOR] ?? "").trim(),
      equipoDice: String(filas[i][COL_EQUIPO] ?? "").trim(),
    });
  }
}

for (const c of celdas) {
  console.log(`\n  OT ${c.ot} · ${c.pestana}!${c.fila}`);
  console.log(`    F sector  ${JSON.stringify(c.sectorDice)} → ${JSON.stringify(SECTOR_BUENO[c.ot])}`);
  console.log(`    G equipo  ${JSON.stringify(c.equipoDice)} → ${JSON.stringify(equipoBueno.get(c.ot))}`);
}

if (celdas.length !== OTS.length) {
  console.log(`\n!! Se esperaban ${OTS.length} filas y se encontraron ${celdas.length}.`);
}

if (!APLICAR) {
  console.log(`\nNo se escribió nada. Con --aplicar se corrigen ${celdas.length * 2} celdas.`);
  process.exit(0);
}

/* ── Aplicar ────────────────────────────────────────────────────────────── */

await escribirCeldas(LIBRO, celdas.flatMap((c) => [
  { pestana: c.pestana, columna: COL_EQUIPO, fila: c.fila, valor: equipoBueno.get(c.ot)! },
  { pestana: c.pestana, columna: COL_SECTOR, fila: c.fila, valor: SECTOR_BUENO[c.ot] },
]));
console.log(`\n  ✓ escritas ${celdas.length * 2} celdas`);

/* ── Releer la planilla y comprobar ─────────────────────────────────────── */

for (const pestana of [...new Set(celdas.map((c) => c.pestana))]) {
  const filas = await leerValores(LIBRO, pestana, { sinFormato: true });
  for (const c of celdas.filter((x) => x.pestana === pestana)) {
    const f = filas[c.fila - 1] ?? [];
    const okS = String(f[COL_SECTOR] ?? "").trim() === SECTOR_BUENO[c.ot];
    const okE = String(f[COL_EQUIPO] ?? "").trim() === equipoBueno.get(c.ot);
    console.log(`  ${okS && okE ? "✓" : "✗"} OT ${c.ot} · F ${JSON.stringify(f[COL_SECTOR])} · G ${JSON.stringify(f[COL_EQUIPO])}`);
  }
}
