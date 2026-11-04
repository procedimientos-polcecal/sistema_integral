// Las OT que quedaron escritas en la planilla y nunca entraron al sistema.
//
// POR QUÉ EXISTE
//
// Crear una OT desde el cuaderno de un contratista son dos escrituras que no
// se pueden atar: primero `altaEnLaPlanilla` toma un número y escribe la fila
// en «Altas del sistema», y después la ruta inserta la fila en
// `ordenes_trabajo`. Si lo segundo falla, la orden **ya está escrita en la
// planilla de producción** —que se borra a mano, fila por fila— y el sistema no
// sabe que existe. La ruta lo dice, con esas palabras, en la pantalla de quien
// generó: «la OT N quedó escrita en la planilla pero no se pudo guardar en el
// sistema». Y ahí se termina el rastro.
//
// El 03/11/2026 pasó con la **OT 2983** («Pasar 1400 barras/cuadrados
// rompedores», fila 100 de «Altas del sistema»). Nadie se enteró hasta que se
// contaron los números: la corrida creó 2972..2982, saltó la 2983 y la
// siguiente corrida arrancó en 2984. El renglón que la generó seguía sin
// convertir, así que **la próxima generación habría creado una segunda OT por
// el mismo trabajo** — y las dos se borran a mano.
//
// Esto es ese conteo, hecho script. **No arregla nada ni escribe nada**: dice
// qué números están en la planilla y no en la base, con lo que dice su fila,
// para que alguien decida. Arreglarlo es insertar la fila que falta y enlazar
// su renglón, como se hizo con la 2983.
//
// LO QUE NO ES
//
// No es lo mismo que una OT sin renglón: una orden cargada a mano desde la
// pantalla de alta también sale por «Altas del sistema» y tampoco tiene
// renglón, y está perfecta. Lo que se busca acá es más estrecho y no admite
// interpretación: **un número que la planilla tiene y la base no**.
//
//   npx tsx scripts/ot-huerfanas-del-cuaderno.mts
//
// Sale 1 si encuentra alguna. Necesita GOOGLE_SERVICE_ACCOUNT_JSON y
// SUPABASE_SERVICE_ROLE_KEY en `.env.local`.

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { leerValores } from "../lib/core/sheets.ts";
import { HOJA_DE_ALTAS } from "../lib/mantenimiento/formulario.ts";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const planilla = process.env.GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!planilla || !url || !clave) {
  console.error("Faltan GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID, NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const db = createClient(url, clave);

// La columna A es el N° de OT y la Y la descripción. Se lee A:Y de una vez
// para poder decir qué dice la fila huérfana: sin eso el informe da un número
// y no alcanza para decidir nada.
const filas = await leerValores(planilla, `${HOJA_DE_ALTAS}!A1:Y`);
const encabezado = filas[0] ?? [];
const COL_DESCRIPCION = encabezado.findIndex((c) => String(c ?? "").toUpperCase().includes("DESCRIPCI"));

type EnLaPlanilla = { numero: number; fila: number; descripcion: string };
const enLaPlanilla: EnLaPlanilla[] = [];
for (let i = 1; i < filas.length; i++) {
  const n = Number(String(filas[i]?.[0] ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) continue;
  enLaPlanilla.push({
    numero: n,
    fila: i + 1,
    descripcion: String(COL_DESCRIPCION >= 0 ? filas[i]?.[COL_DESCRIPCION] ?? "" : "").trim(),
  });
}

if (enLaPlanilla.length === 0) {
  // Una pestaña que no devuelve nada puede estar recalculando, y eso es
  // indistinguible de una pestaña vacía: no se concluye nada.
  console.error(`«${HOJA_DE_ALTAS}» no devolvió ninguna fila con número. No se puede concluir nada: volvé a correrlo.`);
  process.exit(1);
}

const numeros = enLaPlanilla.map((x) => x.numero);
const desde = Math.min(...numeros);
const hasta = Math.max(...numeros);

// De a lotes: un `.in()` con muchos ids arma una URL que PostgREST rechaza.
// Acá alcanza con pedir el rango, que es una sola condición.
const { data: enLaBase, error } = await db
  .from("ordenes_trabajo")
  .select("ot_number")
  .gte("ot_number", desde)
  .lte("ot_number", hasta);
if (error) {
  console.error(`No se pudo leer ordenes_trabajo: ${error.message}`);
  process.exit(1);
}
const tiene = new Set((enLaBase ?? []).map((o) => o.ot_number as number));

const huerfanas = enLaPlanilla.filter((x) => !tiene.has(x.numero));

console.log(`«${HOJA_DE_ALTAS}»: ${enLaPlanilla.length} altas, N° ${desde} a ${hasta}`);
console.log(`ordenes_trabajo en ese rango: ${tiene.size}`);

if (huerfanas.length === 0) {
  console.log("\nHUÉRFANAS 0 — todo lo que está en la planilla está en el sistema.");
  process.exit(0);
}

console.log(`\nHUÉRFANAS ${huerfanas.length} — están en la planilla y no en el sistema:`);
for (const h of huerfanas) {
  console.log(`  OT ${h.numero} · fila ${h.fila} · «${h.descripcion.slice(0, 70)}»`);
}
console.log(
  "\nCada una ya está escrita en la planilla de producción. Antes de volver a generar su\n" +
  "renglón, hay que insertarla en el sistema y enlazarlo: si no, se crea una segunda OT\n" +
  "por el mismo trabajo y las dos se borran a mano."
);
process.exit(1);
