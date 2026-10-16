// Los repuestos de cada equipo, sacados de las OT que ya están cargadas.
//
// POR QUÉ
//
// `equipos_repuestos` está vacía desde que se creó: la ficha de cada equipo
// dice "Sin repuestos anotados" en los 239. Pero la columna `repuesto` de la
// planilla de OT viene cargándose desde diciembre de 2025 y ahí está escrito,
// equipo por equipo, qué se le cambió de verdad. Esto lo lee y arma la lista.
//
// Uso:
//   npx tsx scripts/repuestos-desde-ot.mts                 ← informe, no toca nada
//   npx tsx scripts/repuestos-desde-ot.mts --csv salida.csv
//   npx tsx scripts/repuestos-desde-ot.mts --aplicar       ← escribe los de confianza alta
//   npx tsx scripts/repuestos-desde-ot.mts --aplicar --con-dudosos
//
// **Sin `--aplicar` sólo lee.** Con `--aplicar` inserta en `equipos_repuestos`,
// y salta lo que ya esté cargado con el mismo nombre y código: correrlo dos
// veces no duplica. Es DML, así que lo puede aplicar un agente; no hay DDL.
import { readFileSync, writeFileSync } from "node:fs";
import { createAdminClient } from "../lib/supabase/admin.ts";
import {
  repuestosPorEquipo,
  notaDeFicha,
  type OtConRepuesto,
  type RepuestoDeEquipo,
} from "../lib/mantenimiento/repuestosDesdeOt.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const APLICAR = process.argv.includes("--aplicar");
const CON_DUDOSOS = process.argv.includes("--con-dudosos");
const CSV = process.argv[process.argv.indexOf("--csv") + 1];
const INFORME = "docs/MANTENIMIENTO-REPUESTOS-DESDE-OT.md";

const sb = createAdminClient();

/**
 * PostgREST corta en 1000 filas y no avisa: `ordenes_trabajo` tiene 2.174.
 * Sin esto el informe saldría con los dos tercios más viejos y nada diría que
 * falta algo.
 */
async function traerTodo<T>(tabla: string, select: string, orden: string): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from(tabla).select(select).order(orden).range(desde, desde + 999);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    filas.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return filas;
}

type Equipo = { id: string; name: string; code: string | null; sector_id: string | null };
type Sector = { id: string; nombre: string };

const [ots, equipos, sectores, yaCargados] = await Promise.all([
  traerTodo<OtConRepuesto & { equipo_raw: string | null }>(
    "ordenes_trabajo",
    "ot_number, fecha, equipment_id, equipo_raw, repuesto",
    "ot_number"
  ),
  traerTodo<Equipo>("equipos", "id, name, code, sector_id", "name"),
  traerTodo<Sector>("sectores", "id, nombre", "nombre"),
  traerTodo<{ equipment_id: string; name: string; code: string | null }>(
    "equipos_repuestos",
    "equipment_id, name, code",
    "equipment_id"
  ),
]);

const porId = new Map(equipos.map((e) => [e.id, e]));
const sectorDe = new Map(sectores.map((s) => [s.id, s.nombre]));
const catalogo = repuestosPorEquipo(ots);

/* ── Lo que quedó afuera, que es la mitad del valor de esto ──────────────── */

const conTexto = ots.filter((o) => o.repuesto?.trim() && o.repuesto.trim() !== "-");
const sinEquipo = conTexto.filter((o) => !o.equipment_id);
const todos = [...catalogo.values()].flat();
const dudosos = todos.filter((r) => r.confianza === "revisar");
const aCargar = todos.filter((r) => CON_DUDOSOS || r.confianza === "alta");

console.log(`OT leídas: ${ots.length} · con algo en la columna repuesto: ${conTexto.length}`);
console.log(`Equipos con repuestos: ${catalogo.size} · repuestos distintos: ${todos.length} (${dudosos.length} para revisar)`);
if (sinEquipo.length) {
  console.log(`\nOT con repuesto pero sin equipo enlazado (${sinEquipo.length}) — no entran a ninguna ficha:`);
  for (const o of sinEquipo) console.log(`  OT ${o.ot_number} · ${o.equipo_raw ?? "sin equipo"} · ${o.repuesto}`);
}

/* ── El informe ──────────────────────────────────────────────────────────── */

const ordenados = [...catalogo.entries()].sort((a, b) => {
  const ea = porId.get(a[0]);
  const eb = porId.get(b[0]);
  return (ea?.code ?? "").localeCompare(eb?.code ?? "");
});

let md = `# Repuestos por equipo, leídos de las OT

Generado por \`npx tsx scripts/repuestos-desde-ot.mts\` el ${new Date().toLocaleDateString("es-AR")}.
**Es una propuesta para revisar, no un relevamiento.** Sale de la columna
\`repuesto\` de la planilla de OT, que es texto libre.

De ${ots.length} órdenes de trabajo, ${conTexto.length} tienen algo escrito en esa columna y
${conTexto.length - sinEquipo.length} están enlazadas a un equipo. Eso da **${todos.length} repuestos distintos en
${catalogo.size} equipos**, de los cuales ${dudosos.length} quedaron marcados para revisar.

La columna "OT" dice en cuántas órdenes apareció: es la única señal de
criticidad que da la planilla — lo que se cambia seguido es lo que conviene
tener. "Total" sólo aparece cuando todas las veces vino con cantidad.

`;

for (const [equipoId, lista] of ordenados) {
  const e = porId.get(equipoId);
  const sector = e?.sector_id ? sectorDe.get(e.sector_id) : null;
  md += `\n## ${e?.code ?? "sin código"} — ${e?.name ?? equipoId}${sector ? ` · ${sector}` : ""}\n\n`;
  md += `| Repuesto | Código | OT | Total | Última | |\n|---|---|---:|---:|---|---|\n`;
  for (const r of lista) {
    const marca = r.confianza === "revisar" ? "⚠ revisar" : "";
    const total = r.total !== null ? `${r.total} ${r.unidad}` : "";
    const fecha = r.ultimaFecha ? r.ultimaFecha.split("-").reverse().join("/") : "";
    md += `| ${r.nombre}${r.nota ? ` *(${r.nota})*` : ""} | \`${r.codigo ?? ""}\` | ${r.ots.length} | ${total} | ${fecha} | ${marca} |\n`;
  }
}

if (sinEquipo.length) {
  md += `\n## Las que quedaron afuera\n\nEstas OT tienen repuesto escrito pero no están enlazadas a un equipo, así que\nno entran a ninguna ficha. Casi todas son de edificios, que no son equipos.\n\n`;
  for (const o of sinEquipo) md += `- **OT ${o.ot_number}** · ${o.equipo_raw ?? "sin equipo"} · ${o.repuesto}\n`;
}

writeFileSync(INFORME, md, "utf-8");
console.log(`\nInforme: ${INFORME}`);

if (CSV) {
  const filas = [["codigo_equipo", "equipo", "sector", "repuesto", "codigo", "ots", "cantidad_total", "unidad", "ultima_fecha", "confianza", "nota", "textos_originales"]];
  for (const [equipoId, lista] of ordenados) {
    const e = porId.get(equipoId);
    for (const r of lista) {
      filas.push([
        e?.code ?? "", e?.name ?? equipoId, (e?.sector_id ? sectorDe.get(e.sector_id) : "") ?? "",
        r.nombre, r.codigo ?? "", String(r.ots.length), r.total !== null ? String(r.total) : "",
        r.unidad, r.ultimaFecha ?? "", r.confianza, r.nota ?? "", r.crudos.join(" | "),
      ]);
    }
  }
  writeFileSync(CSV, filas.map((f) => f.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n"), "utf-8");
  console.log(`CSV: ${CSV}`);
}

/* ── Aplicar ─────────────────────────────────────────────────────────────── */

if (!APLICAR) {
  console.log(`\nNo se escribió nada. Con --aplicar se cargan ${aCargar.length} repuestos${CON_DUDOSOS ? " (incluidos los dudosos)" : ""}.`);
  process.exit(0);
}

// Correrlo dos veces no duplica: la tabla no tiene unique y `ON CONFLICT` no
// tendría a qué agarrarse, así que se compara contra lo que ya está.
const clave = (equipmentId: string, name: string, code: string | null) =>
  `${equipmentId}|${name.toUpperCase()}|${(code ?? "").toUpperCase()}`;
const existentes = new Set(yaCargados.map((r) => clave(r.equipment_id, r.name, r.code)));

const nuevos = aCargar
  .map((r: RepuestoDeEquipo) => ({
    equipment_id: r.equipment_id,
    name: r.nombre,
    code: r.codigo,
    notes: notaDeFicha(r),
  }))
  .filter((r) => !existentes.has(clave(r.equipment_id, r.name, r.code)));

console.log(`\nA insertar: ${nuevos.length} (ya estaban ${aCargar.length - nuevos.length})`);
for (let i = 0; i < nuevos.length; i += 200) {
  const lote = nuevos.slice(i, i + 200);
  const { error } = await sb.from("equipos_repuestos").insert(lote);
  if (error) throw new Error(`insertando el lote ${i / 200 + 1}: ${error.message}`);
  console.log(`  lote ${i / 200 + 1}: ${lote.length} filas`);
}
console.log("Listo.");
