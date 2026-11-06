// Una sola vez: dejar las OT que salieron de los partes de CANDIA como las deja
// la generación desde el 04/11/2026 — la descripción con la actividad sola, y
// el cierre, el estado, el contratista y las horas en su columna del master.
//
// Es el gemelo de `corregir-ot-del-cuaderno.mts`, para el otro contratista, y
// hace las mismas dos cosas:
//
//   1. ACORTAR LA DESCRIPCIÓN. Reescribe la columna Y de «Altas del sistema»
//      —la H del master es derrame de un QUERY(IMPORTRANGE) y no guarda lo que
//      se le escribe— y después la base, en ese orden: si la planilla sale y la
//      base no, la próxima sincronización la empareja; al revés, la planilla
//      pisaría la base.
//
//   2. DRENAR LA COLA. Escribe K/M/N/O con `exportarLoPendiente`, la misma
//      función de la pantalla de Órdenes y de la sincronización.
//
// LA SALVAGUARDA. Sólo se reescribe la orden cuyo texto actual es
// **exactamente** el que generaba la versión vieja, reconstruido acá desde sus
// propios renglones con `agruparEnOrdenes`. Si alguien lo editó a mano no
// coincide y la orden se saltea: corregir lo que escribió una persona sería
// peor que dejar el texto largo.
//
// Sin `--escribir` no toca nada.

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { leerValores, escribirCeldas } from "../lib/core/sheets.ts";
import { HOJA_DE_ALTAS, celdasParaCorregirLaAlta } from "../lib/mantenimiento/formulario.ts";
import {
  agruparEnOrdenes, descripcionDeLaOT, finDeLaQuincena, type RenglonParaAgrupar,
} from "../lib/mantenimiento/partesDeContratista.ts";
import { exportarLoPendiente } from "../lib/mantenimiento/sincronizar.ts";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const ESCRIBIR = process.argv.includes("--escribir");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// ── El texto viejo, tal como lo armaba `descripcionDeLaOT` antes ───────────
const fechaCorta = (f: string) => {
  const [, mes, dia] = String(f ?? "").split("-");
  return mes && dia ? `${Number(dia)}/${Number(mes)}` : f;
};

type Grupo = ReturnType<typeof agruparEnOrdenes>["grupos"][number];

function textoViejo(g: Grupo, contratista: string): string {
  const dias = g.detalle
    .map((d) => `${d.lugar_raw.trim()} (parte ${d.parte_numero}, ${fechaCorta(d.fecha)}, ${d.horas} h)`)
    .join("; ");
  return (
    `${g.actividad} — ${contratista}. ` +
    `Quincena del ${fechaCorta(g.quincena)} al ${fechaCorta(finDeLaQuincena(g.quincena))}. ` +
    `${g.horas} h en total. Según los partes diarios: ${dias}. ` +
    `Las horas de cada renglón las anotó quien cargó el parte repartiendo el ` +
    `total escrito en la hoja, así que no son una medición por frente de trabajo.`
  );
}

// ── Los renglones de parte que ya son OT ───────────────────────────────────
const { data: filas } = await db
  .from("mant_partes_contratista_renglones")
  .select("id, actividad, lugar_raw, sector_id, equipo_id, horas, orden_trabajo_id, mant_partes_contratista!inner(numero, fecha, proveedor_id)")
  .not("orden_trabajo_id", "is", null);

type Embed = { numero: number; fecha: string; proveedor_id: string };
const elParte = (e: unknown): Embed | null => (Array.isArray(e) ? (e[0] as Embed) ?? null : (e as Embed) ?? null);

const renglones: (RenglonParaAgrupar & { orden_trabajo_id: string })[] = [];
for (const f of filas ?? []) {
  const parte = elParte(f.mant_partes_contratista);
  if (!parte || !f.sector_id) continue;
  renglones.push({
    id: f.id as string,
    parte_numero: parte.numero,
    fecha: parte.fecha,
    actividad: String(f.actividad).trim(),
    lugar_raw: String(f.lugar_raw).trim(),
    sector_id: f.sector_id as string,
    equipo_id: (f.equipo_id as string | null) ?? null,
    horas: Number(f.horas),
    orden_trabajo_id: f.orden_trabajo_id as string,
  });
}

const { grupos } = agruparEnOrdenes(renglones);
const otDeRenglon = new Map(renglones.map((r) => [r.id, r.orden_trabajo_id]));

const { data: ots } = await db
  .from("ordenes_trabajo")
  .select("id, ot_number, descripcion, contratista, estado, fecha_cierre, horas, sheets_pendiente")
  .in("id", [...new Set(renglones.map((r) => r.orden_trabajo_id))])
  .order("ot_number");
const porId = new Map((ots ?? []).map((o) => [o.id as string, o]));

console.log(`${renglones.length} renglones de parte con OT · ${grupos.length} grupos · ${(ots ?? []).length} órdenes\n`);

type Cambio = { ot_number: number; id: string; antes: string; ahora: string };
const cambios: Cambio[] = [];
const salteadas: { ot_number: number | string; motivo: string }[] = [];

for (const g of grupos) {
  const ids = [...new Set(g.renglon_ids.map((r) => otDeRenglon.get(r)).filter(Boolean))] as string[];
  if (ids.length !== 1) {
    salteadas.push({ ot_number: "(grupo)", motivo: `sus renglones apuntan a ${ids.length} órdenes` });
    continue;
  }
  const o = porId.get(ids[0]);
  if (!o) { salteadas.push({ ot_number: "(grupo)", motivo: "la orden no está en la base" }); continue; }

  const contratista = String(o.contratista ?? "").trim();
  const actual = String(o.descripcion ?? "");
  if (actual !== textoViejo(g, contratista)) {
    salteadas.push({ ot_number: o.ot_number as number, motivo: "el texto no es el que generó el sistema" });
    continue;
  }

  const ahora = descripcionDeLaOT(g);
  if (!ahora.trim()) { salteadas.push({ ot_number: o.ot_number as number, motivo: "quedaría vacía" }); continue; }
  if (ahora === actual) continue;

  cambios.push({ ot_number: o.ot_number as number, id: o.id as string, antes: actual, ahora });
}

console.log(`── DESCRIPCIONES ──  a reescribir: ${cambios.length} · salteadas: ${salteadas.length}`);
for (const c of cambios) {
  console.log(`  OT ${c.ot_number}`);
  console.log(`    antes: ${c.antes.slice(0, 115)}${c.antes.length > 115 ? "…" : ""}`);
  console.log(`    ahora: ${c.ahora}`);
}
for (const s of salteadas) console.log(`  OT ${s.ot_number}: SALTEADA — ${s.motivo}`);

const enCola = (ots ?? []).filter((o) => o.sheets_pendiente);
const { count: colaEntera } = await db
  .from("ordenes_trabajo").select("id", { count: "exact", head: true }).not("sheets_pendiente", "is", null);
console.log(`\n── COLUMNAS DEL MASTER ──  de estas órdenes en la cola: ${enCola.length} · en la cola en total: ${colaEntera}`);

if (!ESCRIBIR) {
  console.log(`\nEn seco. Para escribir: npx tsx scripts/corregir-ot-de-partes-de-candia.mts --escribir`);
  process.exit(0);
}

console.log(`\n=== ESCRIBIENDO ===`);
if (cambios.length > 0) {
  const planilla = process.env.GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID!;
  const filasDeAltas = await leerValores(planilla, HOJA_DE_ALTAS, { sinFormato: true });

  const celdas: { pestana: string; fila: number; columna: number; valor: string | number }[] = [];
  const noUbicadas: number[] = [];
  for (const c of cambios) {
    const donde = celdasParaCorregirLaAlta(filasDeAltas, c.ot_number, { descripcion: c.ahora });
    if (!donde.ok) { noUbicadas.push(c.ot_number); console.log(`  OT ${c.ot_number}: ${donde.error}`); continue; }
    for (const x of donde.celdas) celdas.push({ pestana: HOJA_DE_ALTAS, fila: x.fila, columna: x.columna, valor: x.valor });
  }
  if (celdas.length > 0) {
    await escribirCeldas(planilla, celdas);
    console.log(`  planilla: ${celdas.length} celdas escritas en «${HOJA_DE_ALTAS}»`);
  }

  let enLaBase = 0;
  for (const c of cambios) {
    if (noUbicadas.includes(c.ot_number)) continue;
    const { error } = await db.from("ordenes_trabajo").update({ descripcion: c.ahora }).eq("id", c.id);
    if (error) console.log(`  OT ${c.ot_number}: la base no se pudo actualizar (${error.message})`);
    else enLaBase++;
  }
  console.log(`  base: ${enLaBase} de ${cambios.length} descripciones actualizadas`);
}

const siguen = await exportarLoPendiente(db as never);
console.log(`  cola: quedaron ${siguen.size} sin salir${siguen.size > 0 ? ` (OT ${[...siguen].join(", ")})` : ""}`);
