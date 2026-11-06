// ¿Se cayó alguna planilla por una fórmula? **Sólo lee.**
//
// POR QUÉ EXISTE
//
// El 19/10/2026 la planilla de Compras pasó el día devolviendo columnas vacías
// y nadie se enteró hasta que alguien la abrió. La causa era una fórmula: en
// `APROB COMPRAS` había 1.686 celdas haciendo `IMPORTRANGE` del **propio**
// libro, así que el `IMPORTRANGE` que alimenta al master no resolvió nunca y
// las once pestañas de Compras —las diez por área son `FILTER` del master—
// quedaron vacías al mismo tiempo. Seis días antes había pasado lo mismo por
// otro motivo en la planilla de OT.
//
// Nada avisaba, y no por descuido: `npm test`, `tsc`, `build` y
// `revisar-arbol-commiteado` miran **el código**, y el código estaba bien. Lo
// que se rompió fue el dato del otro lado. Éste es el escaneo que faltaba.
//
// QUÉ DECIDE QUE ALGO ES UNA CAÍDA
//
// Vive en `lib/core/saludDePlanilla.ts`, con sus tests, porque la parte difícil
// no es leer la planilla sino **no sonar por lo que no importa**: hay miles de
// `#N/A` normales —2.420 en `APROB COMPRAS`, 1.659 en el seguimiento— que son
// un `VLOOKUP` sobre una clave que no está. Un informe que los cuenta sale rojo
// siempre, y uno que sale rojo siempre no lo mira nadie.
//
// Uso:
//   npx tsx scripts/revisar-planillas.mts            todas las configuradas
//   npx tsx scripts/revisar-planillas.mts compras    sólo las que coincidan
//
// Sale 1 si hay algún ROMPE. Necesita `GOOGLE_SERVICE_ACCOUNT_JSON`.
import { readFileSync, existsSync } from "node:fs";
// Sólo el tipo: se borra al compilar, así que no carga el módulo antes del env.
import type { Sintoma } from "../lib/core/saludDePlanilla.ts";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { obtenerToken, SCOPE_SHEETS_LECTURA } = await import("../lib/core/google.ts");
const { diagnosticarPestana } = await import("../lib/core/saludDePlanilla.ts");

/**
 * Qué libros mirar.
 *
 * Los dos de Compras llevan el valor documentado en `docs/VARIABLES-VERCEL.md`
 * además de la variable, porque no están en `.env.local` y son justamente los
 * que ya se cayeron. Un libro sin id no es un error: se informa y se sigue.
 */
const LIBROS: { nombre: string; variable: string; porDefecto?: string }[] = [
  { nombre: "Compras · PEDIDOS DE COMPRA", variable: "GOOGLE_SHEETS_COMPRAS_ID",
    porDefecto: "1hnfYHaWBprT9UGOETSoQ9GQCl3B1ZezPr5FPbCrUO80" },
  { nombre: "Compras · formulario", variable: "GOOGLE_SHEETS_COMPRAS_FORMULARIO_ID",
    porDefecto: "1T551q99JfhbXeYzGRbkhcZd6wwc4oh4v83UxPIGFLVM" },
  { nombre: "Compras · seguimiento", variable: "GOOGLE_SHEETS_SEGUIMIENTO_ID" },
  { nombre: "Mantenimiento · OT", variable: "GOOGLE_SHEETS_OT_ID" },
  { nombre: "Mantenimiento · avisos", variable: "GOOGLE_SHEETS_AVISOS_ID" },
  { nombre: "Mantenimiento · OS", variable: "GOOGLE_SHEETS_OS_ID" },
  { nombre: "Mantenimiento · formulario", variable: "GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID" },
  { nombre: "Calidad · envases", variable: "GOOGLE_SHEETS_ENVASES_ID" },
  { nombre: "Calidad · carbonilla", variable: "GOOGLE_SHEETS_CARBONILLA_ID" },
  { nombre: "Calidad · stock carbonilla", variable: "GOOGLE_SHEETS_STOCK_CARBONILLA_ID" },
  { nombre: "Despacho", variable: "GOOGLE_SHEETS_DESPACHO_ID" },
  { nombre: "Inventario", variable: "GOOGLE_SHEETS_INVENTARIO_ID" },
  { nombre: "Producción", variable: "GOOGLE_SHEETS_PRODUCCION_ID" },
];

/** Cuántas filas y columnas se miran por pestaña. Más no aporta y cuesta cuota. */
const TOPE_FILAS = 3000;
const TOPE_COLUMNAS = "AZ";

const token = await obtenerToken([SCOPE_SHEETS_LECTURA]);

async function api(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${res.status} · ${txt.slice(0, 200)}`);
  return JSON.parse(txt);
}

/**
 * La misma región dos veces: el valor que se ve y la fórmula.
 *
 * Google nunca las devuelve juntas, y las dos hacen falta: el valor dice que
 * está rota y la fórmula dice si eso se lleva puesta la pestaña entera.
 */
const batchGet = async (id: string, rangos: string[], formula: boolean) => {
  const q = rangos.map((r) => `ranges=${encodeURIComponent(r)}`).join("&");
  const j = await api(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${q}` +
      (formula ? "&valueRenderOption=FORMULA" : "")
  );
  return ((j.valueRanges ?? []) as any[]).map((v) => (v.values ?? []) as string[][]);
};

async function revisar(id: string): Promise<{ pestana: string; sintomas: Sintoma[] }[]> {
  const meta = await api(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=sheets.properties(title,gridProperties.rowCount)`
  );
  const pestanas: { title: string; filas: number }[] = (meta.sheets ?? []).map((s: any) => ({
    title: s.properties.title,
    filas: Math.min(s.properties.gridProperties?.rowCount ?? TOPE_FILAS, TOPE_FILAS),
  }));

  const rangos = pestanas.map((p) => `${p.title}!A1:${TOPE_COLUMNAS}${p.filas}`);
  const [valores, formulas] = await Promise.all([
    batchGet(id, rangos, false),
    batchGet(id, rangos, true),
  ]);

  return pestanas.map((p, n) => ({
    pestana: p.title,
    sintomas: diagnosticarPestana(valores[n] ?? [], formulas[n] ?? [], id),
  }));
}

// ── Correr ──────────────────────────────────────────────────
const filtro = (process.argv[2] ?? "").toLowerCase();
let rompe = 0;
let mirar = 0;
let revisados = 0;

for (const libro of LIBROS) {
  if (filtro && !libro.nombre.toLowerCase().includes(filtro)) continue;
  const id = process.env[libro.variable] || libro.porDefecto;
  if (!id) {
    console.log(`·  ${libro.nombre}  —  sin configurar (${libro.variable})`);
    continue;
  }

  let hallazgos: { pestana: string; sintomas: Sintoma[] }[];
  try {
    hallazgos = await revisar(id);
  } catch (e) {
    console.log(`?  ${libro.nombre}  —  no se pudo leer: ${(e as Error).message}`);
    continue;
  }
  revisados++;

  const todos = hallazgos.flatMap((h) => h.sintomas.map((s) => ({ ...s, pestana: h.pestana })));
  const rompeAca = todos.filter((s) => s.nivel === "ROMPE");
  const mirarAca = todos.filter((s) => s.nivel === "MIRAR");
  rompe += rompeAca.length;
  mirar += mirarAca.length;

  console.log(`${rompeAca.length ? "✗" : "✓"}  ${libro.nombre}`);
  for (const s of [...rompeAca, ...mirarAca]) {
    console.log(`      ${s.nivel}  ${s.pestana}: ${s.que}${s.donde ? `  →  ${s.donde}` : ""}`);
  }
}

console.log(`\n${revisados} planillas revisadas  ·  ROMPE ${rompe}  ·  MIRAR ${mirar}`);
if (rompe) {
  console.log(
    `\nUn ROMPE quiere decir que esa pestaña no está devolviendo sus datos: la\n` +
      `sincronización de ese módulo está leyendo —o va a leer— menos de lo que hay.`
  );
}
process.exit(rompe ? 1 : 0);
