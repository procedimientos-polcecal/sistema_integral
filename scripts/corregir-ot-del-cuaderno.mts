// Una sola vez: terminar lo que quedó a medias de las 48 OT que el cuaderno de
// PIPARO generó el 03/11/2026, antes de que el texto corto existiera.
//
// Hace dos cosas, y son independientes:
//
//   1. DRENAR LA COLA. Escribe en el master las columnas que llegaron vacías
//      —K FECHA DE CIERRE, M ESTADO, N CONTRATISTA, O HORAS— con la misma
//      función que usan la pantalla de Órdenes y la sincronización
//      (`exportarLoPendiente`). No es nada nuevo: es apurar lo que iba a pasar
//      igual la próxima vez que alguien abriera Órdenes.
//
//   2. ACORTAR LA DESCRIPCIÓN. Reescribe la columna Y de «Altas del sistema»
//      —la H del master es derrame de un QUERY(IMPORTRANGE) y no guarda lo que
//      se le escribe— y después la base, en ese orden: si la planilla sale y la
//      base no, la próxima sincronización la empareja; al revés, la planilla
//      pisaría la base.
//
// LA SALVAGUARDA QUE IMPORTA. Sólo se reescribe la orden cuyo texto actual es
// **exactamente** el que generaba la versión vieja, reconstruido acá abajo
// desde sus propios renglones. Si alguien lo editó a mano, no coincide y la
// orden se saltea: corregir lo que una persona escribió sería peor que dejar el
// texto largo.
//
// Sin `--escribir` no toca nada: imprime lo que haría.

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { leerValores, escribirCeldas } from "../lib/core/sheets.ts";
import { HOJA_DE_ALTAS, celdasParaCorregirLaAlta } from "../lib/mantenimiento/formulario.ts";
import { denominadorComun } from "../lib/mantenimiento/cuadernoDescripcion.ts";
import { totalesDeRenglones, type RenglonDelCuaderno } from "../lib/mantenimiento/cuadernoGrupos.ts";
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

// ── El texto viejo, tal como lo armaba `descripcionDeLaOrden` antes ─────────
// Copiado del código que se sacó: es lo único que permite afirmar «esto lo
// escribió el sistema y nadie lo tocó».
const fechaCorta = (f: string | null) => {
  const [, mes, dia] = String(f ?? "").split("-");
  return mes && dia ? `${Number(dia)}/${Number(mes)}` : "sin fecha";
};
const verHoras = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

function textoViejo(miembros: RenglonDelCuaderno[], contratista: string): string {
  const t = totalesDeRenglones(miembros);
  const cuando = t.desde && t.hasta && t.desde !== t.hasta
    ? `Del ${fechaCorta(t.desde)} al ${fechaCorta(t.hasta)}`
    : `El ${fechaCorta(t.hasta ?? t.desde)}`;
  const horas = t.horas > 0 ? ` ${verHoras(t.horas)} h en total.` : "";
  const detalle = [...miembros]
    .sort((a, b) => (a.fecha ?? "9999").localeCompare(b.fecha ?? "9999") || Number(a.linea ?? 0) - Number(b.linea ?? 0))
    .map((d) => {
      const lugar = d.lugar_raw?.trim();
      const h = Number(d.horas) > 0 ? `, ${verHoras(Number(d.horas))} h` : "";
      return `${d.tarea.trim()}${lugar ? ` — ${lugar}` : ""} (${fechaCorta(d.fecha)}${h})`;
    })
    .join("; ");
  return `${t.tarea} — ${contratista}. ${cuando}.${horas} Según el cuaderno: ${detalle}.`;
}

// ── Las órdenes del cuaderno, con sus renglones ────────────────────────────
const { data: cargas } = await db
  .from("mant_cuadernos")
  .select("id, proveedores(nombre)")
  .order("created_at", { ascending: false })
  .limit(1);
const carga = cargas![0];
const embed = carga.proveedores as { nombre: string } | { nombre: string }[] | null;
const contratista = (Array.isArray(embed) ? embed[0]?.nombre : embed?.nombre) ?? "";

const { data: filas } = await db
  .from("mant_cuadernos_renglones")
  .select("id, cuaderno_id, foto_id, linea, fecha, fecha_hasta, tarea, lugar_raw, sector_id, sector_propuesto, equipo_id, horas, costo, dudoso, motivo_dudoso, heredado, grupo_id, orden_trabajo_id")
  .eq("cuaderno_id", carga.id)
  .order("linea");
const renglones = (filas ?? []) as unknown as RenglonDelCuaderno[];

// Una orden por `orden_trabajo_id`: así se juntan los que una persona agrupó.
const porOT = new Map<string, RenglonDelCuaderno[]>();
for (const r of renglones) {
  if (!r.orden_trabajo_id) continue;
  porOT.set(r.orden_trabajo_id, [...(porOT.get(r.orden_trabajo_id) ?? []), r]);
}

const { data: ots } = await db
  .from("ordenes_trabajo")
  .select("id, ot_number, descripcion, estado, fecha_cierre, horas, contratista, sheets_pendiente")
  .in("id", [...porOT.keys()])
  .order("ot_number");

console.log(`Carga de ${contratista}: ${renglones.length} renglones · ${(ots ?? []).length} órdenes\n`);

// ── 1. Qué descripciones se pueden reescribir ──────────────────────────────
type Cambio = { ot_number: number; id: string; antes: string; ahora: string };
const cambios: Cambio[] = [];
const salteadas: { ot_number: number; motivo: string }[] = [];

for (const o of ots ?? []) {
  const miembros = porOT.get(o.id as string)!;
  const esperado = textoViejo(miembros, contratista);
  const actual = String(o.descripcion ?? "");

  if (actual !== esperado) {
    salteadas.push({ ot_number: o.ot_number as number, motivo: "el texto no es el que generó el sistema" });
    continue;
  }

  const ordenados = [...miembros].sort(
    (a, b) => (a.fecha ?? "9999").localeCompare(b.fecha ?? "9999") || Number(a.linea ?? 0) - Number(b.linea ?? 0)
  );
  const ahora = denominadorComun([...new Set(ordenados.map((m) => m.tarea.trim()))]);

  if (!ahora.trim()) {
    salteadas.push({ ot_number: o.ot_number as number, motivo: "el texto nuevo quedaría vacío" });
    continue;
  }
  if (ahora === actual) continue;

  cambios.push({ ot_number: o.ot_number as number, id: o.id as string, antes: actual, ahora });
}

console.log(`── DESCRIPCIONES ──  a reescribir: ${cambios.length} · salteadas: ${salteadas.length}`);
for (const c of cambios) {
  console.log(`  OT ${c.ot_number}`);
  console.log(`    antes: ${c.antes.slice(0, 120)}${c.antes.length > 120 ? "…" : ""}`);
  console.log(`    ahora: ${c.ahora}`);
}
for (const s of salteadas) console.log(`  OT ${s.ot_number}: SALTEADA — ${s.motivo}`);

// ── 2. Qué hay en la cola de exportación ───────────────────────────────────
const enCola = (ots ?? []).filter((o) => o.sheets_pendiente);
const { count: colaEntera } = await db
  .from("ordenes_trabajo")
  .select("id", { count: "exact", head: true })
  .not("sheets_pendiente", "is", null);
console.log(`\n── COLUMNAS DEL MASTER ──  de esta carga en la cola: ${enCola.length} · en la cola en total: ${colaEntera}`);
console.log(`  (se drena la cola entera, que es lo que hace la pantalla de Órdenes)`);
console.log(`  ejemplo: OT ${enCola[0]?.ot_number} → cierre ${enCola[0]?.fecha_cierre} · estado ${enCola[0]?.estado} · contratista ${enCola[0]?.contratista} · ${enCola[0]?.horas} h`);

if (!ESCRIBIR) {
  console.log(`\nEn seco. Para escribir de verdad: npx tsx scripts/corregir-ot-del-cuaderno.mts --escribir`);
  process.exit(0);
}

// ── 3. Escribir: primero la planilla, después la base ──────────────────────
console.log(`\n=== ESCRIBIENDO ===`);

if (cambios.length > 0) {
  const planilla = process.env.GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID!;
  // Una sola lectura de la pestaña para las 48, y una sola escritura: cada
  // `corregirLaAlta` relee el libro entero, y 48 lecturas no agregan nada.
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

  const escritas = new Set(cambios.filter((c) => !noUbicadas.includes(c.ot_number)).map((c) => c.ot_number));
  let enLaBase = 0;
  for (const c of cambios) {
    if (!escritas.has(c.ot_number)) continue;
    const { error } = await db.from("ordenes_trabajo").update({ descripcion: c.ahora }).eq("id", c.id);
    if (error) console.log(`  OT ${c.ot_number}: la base no se pudo actualizar (${error.message})`);
    else enLaBase++;
  }
  console.log(`  base: ${enLaBase} de ${cambios.length} descripciones actualizadas`);
}

// `exportarLoPendiente` pide el cliente admin de la app; acá vale el mismo.
const siguen = await exportarLoPendiente(db as never);
console.log(`  cola: quedaron ${siguen.size} sin salir${siguen.size > 0 ? ` (OT ${[...siguen].join(", ")})` : ""}`);
