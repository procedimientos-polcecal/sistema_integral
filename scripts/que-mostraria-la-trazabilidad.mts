/**
 * Qué van a mostrar las dos pantallas de la trazabilidad del repuesto, hoy,
 * contra la base de producción — sin abrir un navegador y sin tocar nada.
 *
 * Existe porque esa función no se puede comprobar de ninguna otra forma: está
 * entera detrás del login, sus tests son sobre funciones puras con datos
 * inventados, y `ordenes_trabajo_repuestos.movimiento_id` tiene 0 filas, así
 * que nada del mecanismo se ejercitó nunca con datos reales. Lee y no escribe.
 *
 * Lo que contesta, que es lo que no se deduce del código:
 *
 * 1. Cuántas fichas de RI van a ofrecer candidatas y cuántas no van a ofrecer
 *    ninguna. Una ficha sin candidatas no está rota: quiere decir que la
 *    entrada de ese pedido no tiene salidas del mismo artículo en su ventana.
 * 2. Cuántos renglones de repuesto de OT tienen artículo del pañol. Mientras
 *    sea 0, **toda** salida que la ficha liste va a decir «sin justificar»: es
 *    la precondición de la mitad B, no un error.
 * 3. Si el tope de 10 está recortando, y cuánto destapa el «ver todas».
 *
 * `ENV_PATH` existe para correrlo desde un worktree, que no tiene `.env.local`
 * propio: se le pasa el del checkout principal. Nunca exportar las variables
 * por el shell — el JSON de la cuenta de servicio se rompe y el error lo
 * imprime entero, clave privada incluida.
 *
 *   npx tsx scripts/que-mostraria-la-trazabilidad.mts
 */

import { readFileSync, existsSync } from "node:fs";

const env = process.env.ENV_PATH
  ? new URL(`file://${process.env.ENV_PATH}`)
  : new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { salidasCandidatas, SIN_VENTANA, TOPE_DE_CANDIDATAS, DIAS_DE_LA_VENTANA } =
  await import("../lib/inventario/salidasDelRepuesto.ts");
type Salida = Awaited<ReturnType<typeof traerSalidas>>[number];

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!URL_BASE || !KEY) throw new Error("Falta la URL de Supabase o la service role key");

/** PostgREST corta en 1000 filas y no avisa: se pagina siempre. */
async function traerTodo<T>(ruta: string): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const r = await fetch(`${URL_BASE}/rest/v1/${ruta}`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        Range: `${desde}-${desde + 999}`,
      },
    });
    if (!r.ok) throw new Error(`${ruta} -> ${r.status} ${await r.text()}`);
    const lote = (await r.json()) as T[];
    out.push(...lote);
    if (lote.length < 1000) return out;
  }
}

const COLUMNAS = "id,articulo_id,fecha,cantidad,solicitante,sector_raw,equipo_raw,tipo";

function traerSalidas() {
  return traerTodo<{
    id: string; articulo_id: string | null; fecha: string | null; cantidad: number;
    solicitante: string | null; sector_raw: string | null; equipo_raw: string | null; tipo: string;
  }>(`inventario_movimientos?select=${COLUMNAS}&order=id`);
}

const movimientos = await traerSalidas();
const salidas = movimientos.filter((m) => m.tipo === "salida");
const entradas = movimientos.filter((m) => m.tipo === "entrada");

const renglones = await traerTodo<{
  id: string; work_order_id: string | null; articulo_id: string | null; movimiento_id: string | null;
}>("ordenes_trabajo_repuestos?select=id,work_order_id,articulo_id,movimiento_id&order=id");

const requerimientos = await traerTodo<{ id: string; nro_ri: number | null; ot_id: string | null }>(
  "compras_requerimientos?select=id,nro_ri,ot_id&order=id",
);

console.log(`Movimientos: ${movimientos.length}  (${entradas.length} entradas · ${salidas.length} salidas)`);
console.log(`Renglones de repuesto de OT: ${renglones.length}`);
console.log(`Requerimientos: ${requerimientos.length}`);
console.log();

// --- 2. La precondición de la mitad B -------------------------------------
const conArticulo = renglones.filter((r) => r.articulo_id).length;
const conMovimiento = renglones.filter((r) => r.movimiento_id).length;
console.log("## El renglón de repuesto (la mitad B)");
console.log(`  con artículo del pañol elegido: ${conArticulo} de ${renglones.length}`);
console.log(`  con salida declarada:           ${conMovimiento} de ${renglones.length}`);
if (conArticulo === 0) {
  console.log("  → Toda salida que la ficha liste va a decir «sin justificar».");
  console.log("    Es la precondición, no un error: la ficha parte del artículo de la");
  console.log("    entrada y no del renglón de la OT.");
}
console.log();

// --- 1 y 3. Lo que ofrecería cada ficha -----------------------------------
// La entrada de un RI es el movimiento que lo nombra. Se mira sólo esa columna
// si existe; si no, el script lo dice en vez de adivinar por nombre.
const tieneColumna = await fetch(
  `${URL_BASE}/rest/v1/inventario_movimientos?select=requerimiento_id&limit=1`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } },
);
let porRequerimiento = new Map<string, typeof entradas>();
if (tieneColumna.ok) {
  const conRI = await traerTodo<{ id: string; requerimiento_id: string | null }>(
    "inventario_movimientos?select=id,requerimiento_id&tipo=eq.entrada&order=id",
  );
  const deQuien = new Map(conRI.map((m) => [m.id, m.requerimiento_id]));
  for (const e of entradas) {
    const ri = deQuien.get(e.id);
    if (!ri) continue;
    const lista = porRequerimiento.get(ri) ?? [];
    lista.push(e);
    porRequerimiento.set(ri, lista);
  }
} else {
  console.log("## Aviso");
  console.log("  `inventario_movimientos.requerimiento_id` no existe, así que no se");
  console.log("  puede decir qué entrada es de qué RI. Se mide sobre TODAS las entradas.");
  console.log();
  for (const e of entradas) porRequerimiento.set(e.id, [e]);
}

let sinNinguna = 0;
let conAlguna = 0;
let recortadas = 0;
let vueltaPerdida = 0;
let vueltaVacia = 0;
const histograma = new Map<number, number>();

for (const [, lista] of porRequerimiento) {
  for (const e of lista) {
    const cand = salidasCandidatas(e, salidas);
    // Lo que de verdad devuelve `?todas=1`: levanta la **ventana** y conserva
    // el tope. Y como la ventana limita hacia adelante y el orden es «la más
    // nueva primero», levantarla deja entrar salidas más nuevas que ordenan
    // ANTES: la lista de «ver todas» puede no contener a ninguna de las que la
    // lista corta mostraba.
    const todas = salidasCandidatas(e, salidas, { dias: SIN_VENTANA });
    // Y cuántas existen en total, que es lo que ninguna de las dos muestra.
    const universo = salidasCandidatas(e, salidas, {
      dias: SIN_VENTANA, tope: Number.MAX_SAFE_INTEGER,
    });

    if (cand.length === 0) sinNinguna++;
    else conAlguna++;
    if (universo.length > TOPE_DE_CANDIDATAS) recortadas++;

    if (cand.length > 0) {
      const enTodas = new Set(todas.map((s) => s.id));
      const sobreviven = cand.filter((s) => enTodas.has(s.id)).length;
      if (sobreviven < cand.length) vueltaPerdida++;
      if (sobreviven === 0) vueltaVacia++;
    }

    const k = Math.min(cand.length, 10);
    histograma.set(k, (histograma.get(k) ?? 0) + 1);
  }
}

const total = sinNinguna + conAlguna;
console.log(`## Lo que ofrecería la ficha (ventana de ${DIAS_DE_LA_VENTANA} días, tope ${TOPE_DE_CANDIDATAS})`);
console.log(`  entradas miradas:          ${total}`);
console.log(`  con al menos una candidata: ${conAlguna}  (${((conAlguna / total) * 100).toFixed(1)} %)`);
console.log(`  sin ninguna:                ${sinNinguna}  (${((sinNinguna / total) * 100).toFixed(1)} %)`);
console.log(`  con más de ${TOPE_DE_CANDIDATAS} salidas en total: ${recortadas}  (el tope recorta: hay más de las que se ven)`);
console.log();
console.log("  y qué hace el «ver todas» (levanta la ventana, conserva el tope):");
console.log(`    entradas donde pierde alguna de las que mostraba: ${vueltaPerdida}`);
console.log(`    entradas donde no queda NINGUNA de las de antes:  ${vueltaVacia}`);
if (vueltaPerdida > 0) {
  console.log("    → Es el riesgo asumido y no un error: la ventana limita hacia");
  console.log("      adelante y el orden es «la más nueva primero», así que levantarla");
  console.log("      deja entrar salidas posteriores que ordenan antes. Desde «ver");
  console.log("      todas» no hay botón para volver a la lista corta.");
}
console.log();
console.log("  candidatas por entrada:");
for (const k of [...histograma.keys()].sort((a, b) => a - b)) {
  const n = histograma.get(k)!;
  console.log(`    ${String(k).padStart(2)}${k === 10 ? "+" : " "} → ${String(n).padStart(5)}  ${"█".repeat(Math.ceil((n / total) * 60))}`);
}
console.log();

// --- El nexo de la mitad A ------------------------------------------------
const conOT = requerimientos.filter((r) => r.ot_id).length;
console.log("## El nexo del pedido con la OT (la mitad A)");
console.log(`  requerimientos que recuerdan su OT: ${conOT} de ${requerimientos.length}`);
if (conOT === 0) {
  console.log("  → Ninguno todavía: la columna nació vacía y se llena cuando alguien");
  console.log("    aprieta «Pedir a Compras» desde una OT. No hay relleno hacia atrás.");
}
