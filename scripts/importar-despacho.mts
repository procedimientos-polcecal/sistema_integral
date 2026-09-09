// Importa el histórico de la planilla `ORDENES DE CARGA - Detalle` a
// `despacho_ordenes_carga`. Se corre una vez.
//
// Hace lo mismo que `POST /api/despacho/importar` y con las mismas funciones
// —`ordenesDeLaPlanilla`, `pestanaDelMes`, `leerValores`—, no con una copia: si
// el parseo cambia, cambia en los dos lados a la vez. Existe aparte porque la
// ruta pide una sesión de un admin de Despacho en el navegador, y esto se
// resuelve desde acá con el service role.
//
// Uso:
//   npx tsx scripts/importar-despacho.mts            # ensayo: lee y cuenta, no escribe
//   npx tsx scripts/importar-despacho.mts --escribir # escribe
//
// Idempotente: `ignoreDuplicates` por `numero`, así que lo que ya está en el
// sistema gana y volver a correrlo sólo agrega lo que falta.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { leerValores, listarPestanas } from "../lib/core/sheets.ts";
import { ordenesDeLaPlanilla } from "../lib/despacho/importar.ts";
import { pestanaDelMes } from "../lib/despacho/planilla.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

// El id va acá y no por `GOOGLE_SHEETS_DESPACHO_ID` a propósito: esa variable
// es la que usa el espejo para **escribir**, y todavía no está cargada. Un
// script de lectura no tiene por qué esperarla.
const LIBRO =
  process.env.GOOGLE_SHEETS_DESPACHO_ID || "1jF2lqDn_9H_BRQ8TQFNopfappOPyMGCQwFsGkWSkonM";

const escribir = process.argv.includes("--escribir");
const LOTE = 1000;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

interface Leida {
  numero: string;
  fecha: string;
  cliente_raw: string | null;
  producto_raw: string | null;
  entrada_predio: string | null;
  inicio_carga: string | null;
  fin_carga: string | null;
  salida_predio: string | null;
  notas: string | null;
  sheets_fila: number | null;
}

const pestanas = await listarPestanas(LIBRO);
console.log(`Libro con ${pestanas.length} pestañas.\n`);

const todas: Leida[] = [];

for (const pestana of pestanas) {
  // `sinFormato`: hay celdas de fecha con el dato adentro y un formato de
  // número que las muestra vacías. Leyendo el texto formateado, esas órdenes se
  // perderían por "no tienen fecha".
  const valores = await leerValores(LIBRO, pestana, { sinFormato: true });
  const { ordenes, filaDeEncabezados, salteadas } = ordenesDeLaPlanilla(valores);

  if (filaDeEncabezados === null) {
    console.log(`  ${pestana.padEnd(18)} ENCABEZADOS NO RECONOCIDOS — se saltea la pestaña`);
    continue;
  }

  let fueraDeMes = 0;
  for (const o of ordenes) {
    // `sheets_fila` sólo si el mes de la orden coincide con la pestaña: si no,
    // una corrección reescribiría la fila de la hoja equivocada y pisaría una
    // orden ajena. Con la fila en null, agrega un renglón — visible.
    const coincide = pestanaDelMes(o.fecha) === pestana;
    if (!coincide) fueraDeMes++;
    todas.push({
      numero: o.numero,
      fecha: o.fecha,
      cliente_raw: o.cliente_raw,
      producto_raw: o.producto_raw,
      entrada_predio: o.entrada_predio,
      inicio_carga: o.inicio_carga,
      fin_carga: o.fin_carga,
      salida_predio: o.salida_predio,
      notas: o.notas,
      sheets_fila: coincide ? o.fila : null,
    });
  }

  console.log(
    `  ${pestana.padEnd(18)} encabezados=fila ${filaDeEncabezados + 1}` +
      `  ordenes=${String(ordenes.length).padStart(4)}` +
      `  salteadas=${salteadas}  fechaDeOtroMes=${fueraDeMes}`
  );
}

// El mismo Nº en dos pestañas choca contra la constraint de `numero` y voltearía
// el lote entero. Se queda el primero y se cuenta: el número es único en el
// talonario, así que un repetido es un error de tipeo que alguien tiene que ver.
const vistos = new Set<string>();
const ordenes: Leida[] = [];
const repetidos: string[] = [];
for (const o of todas) {
  if (vistos.has(o.numero)) { repetidos.push(o.numero); continue; }
  vistos.add(o.numero);
  ordenes.push(o);
}

console.log(`\nLeídas ${todas.length} filas → ${ordenes.length} órdenes a importar.`);
if (repetidos.length) {
  console.log(`Nº repetidos en la planilla (${repetidos.length}): ${repetidos.join(", ")}`);
}
console.log(`Sin fila de planilla (fecha de otro mes): ${ordenes.filter((o) => o.sheets_fila === null).length}`);
const fechas = ordenes.map((o) => o.fecha).sort();
console.log(`Rango de fechas: ${fechas[0]} … ${fechas.at(-1)}`);

/*
 * Las fechas que no caen en ningún mes que el libro tenga como pestaña.
 *
 * Son años mal tipeados —2006 por 2026— y no son inocuas: la pestaña de una
 * orden se despeja de su fecha, así que corregir una de éstas haría que el
 * espejo cree una pestaña "JULIO 2006" en el libro. Se informan para que se
 * arreglen en el sistema después de importar; el importador no las toca, porque
 * adivinar el año es inventar un dato.
 */
const mesesDelLibro = new Set(pestanas);
const fueraDelLibro = ordenes.filter((o) => !mesesDelLibro.has(pestanaDelMes(o.fecha) ?? ""));
if (fueraDelLibro.length) {
  console.log(`
Fechas que no caen en ninguna pestaña del libro (${fueraDelLibro.length}) — revisar a mano:`);
  for (const o of fueraDelLibro) {
    console.log(`  Nº ${o.numero}  fecha=${o.fecha}  → pestaña "${pestanaDelMes(o.fecha)}"  cliente=${o.cliente_raw}`);
  }
}

if (!escribir) {
  console.log("\nENSAYO: no se escribió nada. Para escribir, --escribir");
  console.log("Muestra:");
  for (const o of ordenes.slice(0, 3)) console.log("  " + JSON.stringify(o));
  process.exit(0);
}

let insertadas = 0;
for (let i = 0; i < ordenes.length; i += LOTE) {
  const lote = ordenes.slice(i, i + LOTE);
  const { data, error } = await sb
    .from("despacho_ordenes_carga")
    // `cargado_por` en null a propósito: nadie la cargó en el sistema. Es lo que
    // distingue una fila importada de una cargada en la balanza.
    .upsert(lote, { onConflict: "numero", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error(`\nFALLÓ en el lote que arranca en ${i}: ${error.message}`);
    console.error(`Insertadas antes de fallar: ${insertadas}. Reintentar es seguro.`);
    process.exit(1);
  }
  insertadas += (data ?? []).length;
  console.log(`  lote ${i}–${i + lote.length - 1}: ${(data ?? []).length} insertadas`);
}

const { count } = await sb
  .from("despacho_ordenes_carga")
  .select("id", { count: "exact", head: true });

console.log(`\nInsertadas ${insertadas}. Ya estaban ${ordenes.length - insertadas}.`);
console.log(`La tabla quedó con ${count} órdenes.`);
