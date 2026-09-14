// Importa el histórico 2026 de acarreo (fleteros, tarifas, pesadas de
// balanza y las tres actividades sin pesada) desde la planilla real de
// transporte a las tablas del módulo Cantera. Se corre una vez.
//
// Uso:
//   npx tsx scripts/importar-acarreo-2026.mts             # ensayo: lee y cuenta, no escribe
//   npx tsx scripts/importar-acarreo-2026.mts --escribir  # escribe
//
// Requiere que `20260914091110_cantera_acarreo_fleteros_y_tarifas.sql` ya
// haya corrido (fleteros, tarifas_acarreo, acarreos, pesadas).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { leerValores } from "../lib/core/sheets.ts";
import { FLETEROS_CONOCIDOS, pesadaDeFilaCruda, patentesParaMostrar } from "../lib/cantera/pesadas.ts";
import { TIPOS_DE_ACARREO } from "../lib/cantera/acarreo.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const LIBRO = process.env.GOOGLE_SHEETS_ACARREO_ID || "1E8mA7RPRPU3sXR0G0m9Oiwk7yBt0mo0rMTRFlX9ZHuw";
const escribir = process.argv.includes("--escribir");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ── 1. Fleteros: los 11 conocidos, con sus patentes (Schneider tiene dos) ──
console.log("── Fleteros ──");
if (escribir) {
  const filas = FLETEROS_CONOCIDOS.map((f) => ({ nombre: f.nombre, patente: patentesParaMostrar(f.nombre) }));
  const { error } = await sb.from("cantera_fleteros").upsert(filas, { onConflict: "nombre" });
  if (error) console.log(`  ! ${error.message}`);
}
const { data: fleterosDB } = await sb.from("cantera_fleteros").select("id, nombre");
const idPorFletero = new Map<string, string>((fleterosDB ?? []).map((f) => [f.nombre as string, f.id as string]));
console.log(`  ${idPorFletero.size} fleteros en la base.`);
if (idPorFletero.size === 0 && !escribir) {
  console.log("  (ensayo: todavía no hay fleteros — se crean con --escribir)");
}

// ── 2. Tarifas: las tres vigencias reales relevadas ──
console.log("\n── Tarifas ──");
const tarifasSheet = await leerValores(LIBRO, "Tarifas");
const PERIODOS = [
  { columna: 3, desde: "2026-03-01", hasta: "2026-04-30" }, // marzo-abril
  { columna: 2, desde: "2026-05-01", hasta: "2026-06-30" }, // mayo-junio
  { columna: 1, desde: "2026-07-01", hasta: null as string | null }, // julio-agosto, vigente
];

function tipoDeEtiqueta(etiqueta: string): string | null {
  const norm = etiqueta.trim().toLowerCase();
  const t = TIPOS_DE_ACARREO.find((t) => t.etiqueta.trim().toLowerCase() === norm);
  return t?.codigo ?? null;
}

const tarifasAInsertar: { tipo: string; desde: string; hasta: string | null; tarifa: number }[] = [];
const etiquetasSinTipo: string[] = [];
for (const fila of tarifasSheet.slice(2)) {
  const etiqueta = (fila[0] ?? "").trim();
  if (!etiqueta) continue;
  const tipo = tipoDeEtiqueta(etiqueta);
  if (!tipo) { etiquetasSinTipo.push(etiqueta); continue; }
  for (const p of PERIODOS) {
    const texto = (fila[p.columna] ?? "").trim();
    if (!texto) continue;
    const tarifa = Number(texto.replace(/[$.\s]/g, "").replace(",", "."));
    if (!isFinite(tarifa) || tarifa <= 0) continue;
    tarifasAInsertar.push({ tipo, desde: p.desde, hasta: p.hasta, tarifa });
  }
}
console.log(`  ${tarifasAInsertar.length} vigencias de tarifa para insertar.`);
if (etiquetasSinTipo.length) console.log(`  Sin tipo en el vocabulario (se ignoran): ${etiquetasSinTipo.join(", ")}`);
if (escribir && tarifasAInsertar.length) {
  const { error } = await sb.from("cantera_tarifas_acarreo").upsert(tarifasAInsertar, { onConflict: "tipo,desde" });
  if (error) console.log(`  ! ${error.message}`);
}

// ── 3. Pesadas: toda "Datos" ──
console.log("\n── Pesadas ──");
const datosSheet = await leerValores(LIBRO, "Datos!A2:Y100000");
const pesadas = datosSheet.map(pesadaDeFilaCruda).filter((p): p is NonNullable<typeof p> => p !== null);
const resueltas = pesadas.filter((p) => p.fleteroNombre).length;
const sinResolver = pesadas.length - resueltas;
console.log(`  ${datosSheet.length} filas leídas, ${pesadas.length} son pesadas con material.`);
console.log(`  ${resueltas} con fletero reconocido, ${sinResolver} sin fletero (nombre ambiguo o desconocido).`);
if (sinResolver > 0) {
  const porNombre = new Map<string, number>();
  for (const p of pesadas) if (!p.fleteroNombre) porNombre.set(p.fleteroRaw ?? "(vacío)", (porNombre.get(p.fleteroRaw ?? "(vacío)") ?? 0) + 1);
  console.log(`  Detalle: ${[...porNombre.entries()].map(([n, c]) => `${n}×${c}`).join(", ")}`);
}

if (escribir) {
  // Sin clave natural (dos pesadas bien podrían tener misma fecha/hora/bruto)
  // no hay con qué hacer upsert: se borra todo y se recarga entero cada vez.
  // Es seguro porque esta tabla es 100% reproducible desde "Datos" —nada acá
  // lo carga a mano—, y evita el error real que ya pasó una vez de insertar
  // sobre lo que ya estaba y duplicar 7500 filas.
  const { error: errDel } = await sb.from("cantera_pesadas").delete().not("id", "is", null);
  if (errDel) { console.log(`  ! borrando lo anterior: ${errDel.message}`); process.exit(1); }

  const filas = pesadas.map((p) => ({
    fecha: p.fecha,
    hora: p.hora,
    bruto: p.bruto,
    tara: p.tara,
    tipo: p.tipo,
    toneladas: p.toneladas,
    origen: p.origen,
    destino: p.destino,
    fletero_raw: p.fleteroRaw,
    fletero_id: p.fleteroNombre ? (idPorFletero.get(p.fleteroNombre) ?? null) : null,
  }));
  const TAMANO_LOTE = 500;
  let insertadas = 0;
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const lote = filas.slice(i, i + TAMANO_LOTE);
    const { error } = await sb.from("cantera_pesadas").insert(lote);
    if (error) { console.log(`  ! lote ${i}: ${error.message}`); break; }
    insertadas += lote.length;
  }
  console.log(`  ${insertadas} pesadas insertadas (reemplazan lo que hubiera antes).`);
}

// ── 4. Las tres actividades sin pesada, desde "Ingreso de Datos" ──
console.log("\n── Actividades manuales (Horas destape, Viaje de bloques, Hora bochones) ──");
const ingresoSheet = await leerValores(LIBRO, "Ingreso de Datos");
const MESES_2026 = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
const ACTIVIDADES_MANUALES = new Set(["Horas destape", "Viaje de bloques", "Hora movimiento bochones pozo"]);

function fleteroDeBloque(encabezado: string): string | null {
  // "Amaray  –  XAG 816" -> "Amaray"; "Schneider 1 y 2 – GBL 929 - (VGC 250)"
  // -> "Schneider". Por "empieza con", ordenado del nombre más largo al más
  // corto para que "Dumerauf 1" no caiga en un "Dumerauf" que no existe como
  // fletero solo.
  const texto = encabezado.trim().toLowerCase();
  const porLargo = [...FLETEROS_CONOCIDOS].sort((a, b) => b.nombre.length - a.nombre.length);
  return porLargo.find((f) => texto.startsWith(f.nombre.toLowerCase()))?.nombre ?? null;
}

// Se junta primero por nombre de fletero (no por id): en el ensayo todavía no
// hay fleteros en la base, y contar cuántos renglones se van a insertar no
// tendría que depender de que ya existan.
const acarreosPorNombre: { fleteroNombre: string; tipo: string; mes: string; cantidad: number }[] = [];
let fleteroActual: string | null = null;
const bloquesSinFletero: string[] = [];
for (const fila of ingresoSheet.slice(1)) {
  if (fila[0] && fila[0].trim()) {
    fleteroActual = fleteroDeBloque(fila[0]);
    if (!fleteroActual) bloquesSinFletero.push(fila[0]);
    continue;
  }
  const actividad = (fila[1] ?? "").trim();
  if (!fleteroActual || !ACTIVIDADES_MANUALES.has(actividad)) continue;
  const tipo = TIPOS_DE_ACARREO.find((t) => t.etiqueta === actividad)?.codigo;
  if (!tipo) continue;
  MESES_2026.forEach((mes, i) => {
    const texto = (fila[2 + i] ?? "").trim();
    if (!texto || texto === "-") return;
    const cantidad = Number(texto.replace(/\./g, "").replace(",", "."));
    if (!isFinite(cantidad) || cantidad <= 0) return;
    acarreosPorNombre.push({ fleteroNombre: fleteroActual!, tipo, mes: `${mes}-01`, cantidad });
  });
}
console.log(`  ${acarreosPorNombre.length} renglones mensuales para insertar.`);
if (bloquesSinFletero.length) console.log(`  Bloques de fletero sin reconocer: ${bloquesSinFletero.join(" | ")}`);

const acarreosAInsertar = acarreosPorNombre
  .map((a) => ({ fletero_id: idPorFletero.get(a.fleteroNombre), tipo: a.tipo, mes: a.mes, cantidad: a.cantidad }))
  .filter((a): a is { fletero_id: string; tipo: string; mes: string; cantidad: number } => Boolean(a.fletero_id));
if (escribir && acarreosAInsertar.length) {
  const { error } = await sb.from("cantera_acarreos").upsert(acarreosAInsertar, { onConflict: "fletero_id,tipo,mes" });
  if (error) console.log(`  ! ${error.message}`);
}

console.log(escribir ? "\nListo, escrito." : "\nEnsayo: nada se escribió. Correr con --escribir para aplicar.");
