// Importa las voladuras, bochones y consumos de 2026 de la planilla
// "Control de perforaciones, voladuras y bochones" a las tablas del módulo
// Cantera. Se corre una vez.
//
// Hace lo mismo que hará `POST /api/cantera/importar`, con las mismas funciones
// puras de `lib/cantera/importar.ts` —no con una copia—. Existe aparte porque
// la ruta pide una sesión de un admin en el navegador y esto se resuelve con el
// service role.
//
// Uso:
//   npx tsx scripts/importar-cantera-2026.mts             # ensayo: lee y cuenta, no escribe
//   npx tsx scripts/importar-cantera-2026.mts --escribir  # escribe
//
// Idempotente: las voladuras y bochones se insertan con ignoreDuplicates por
// código, así que lo que ya está en el sistema gana y volver a correrlo sólo
// agrega lo que falta (por ejemplo, después de cargar el yacimiento Alcancía).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { leerValores } from "../lib/core/sheets.ts";
import {
  voladurasDe2026,
  bochonesDe2026,
  consumosDe,
} from "../lib/cantera/importar.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const LIBRO =
  process.env.GOOGLE_SHEETS_CANTERA_ID || "1npg2BczhDN4MF49-fNG6kceSn4BINpUkF1ftFebVn9k";
const escribir = process.argv.includes("--escribir");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// ── Los yacimientos que hay en el SdG ──
const { data: yacimientos, error: errYac } = await sb
  .from("cantera_yacimientos")
  .select("id, codigo");
if (errYac) throw errYac;
const idPorCodigo = new Map<string, string>(
  (yacimientos ?? []).map((y) => [y.codigo as string, y.id as string])
);
const codigosYac = [...idPorCodigo.keys()];
console.log(`Yacimientos en el SdG: ${codigosYac.join(", ")}`);

// ── Leer las pestañas ──
const [perf, vol, boch, cons] = await Promise.all([
  leerValores(LIBRO, "PERFORACIÓN", { sinFormato: true }),
  leerValores(LIBRO, "VOLADURAS", { sinFormato: true }),
  leerValores(LIBRO, "BOCHONES", { sinFormato: true }),
  leerValores(LIBRO, "CONSUMOS", { sinFormato: true }),
]);

const { filas: voladuras, saltadas: volSaltadas } = voladurasDe2026(perf, vol, codigosYac);
const { filas: bochones, saltadas: bochSaltadas } = bochonesDe2026(boch, codigosYac);
const codigosVoladura = new Set(voladuras.map((v) => v.codigo));
const consumos = consumosDe(cons, codigosVoladura);

console.log(`\nVoladuras 2026: ${voladuras.length}`);
console.log(`  sin fecha de voladura (perforadas, no voladas): ${voladuras.filter((v) => !v.vol_fecha).length}`);
console.log(`Bochones 2026:  ${bochones.length}`);
console.log(`Consumos:       ${consumos.length} renglones`);
if (volSaltadas.length || bochSaltadas.length) {
  console.log("\nSaltadas:");
  for (const s of [...volSaltadas, ...bochSaltadas]) console.log(`  ${s.codigo} — ${s.motivo}`);
}

console.log("\nPrimeras voladuras:");
for (const v of voladuras.slice(0, 8)) {
  console.log(
    `  ${v.codigo}  ${v.yacimiento_codigo}  perf ${v.pozos ?? "?"}×${v.metros_por_pozo ?? "?"}m  ` +
      `USD/m ${v.perf_precio_usd_m ?? "?"}  vol ${v.vol_fecha ?? "sin volar"}  ${v.toneladas_planilla ?? "?"} t pl.`
  );
}

if (!escribir) {
  console.log("\nEnsayo: no se escribió nada. Con --escribir se importa.");
  process.exit(0);
}

// ── Escribir ──
function paraInsert(v: (typeof voladuras)[number]) {
  // La planilla vieja no trae el desglose de pozos por profundidad: se arma un
  // tramo único con el promedio. Cuando alguien edite la voladura en el SdG,
  // carga el desglose real.
  const perf_tramos =
    v.pozos != null && v.metros_por_pozo != null
      ? [{ pozos: v.pozos, metros: v.metros_por_pozo }]
      : null;
  return {
    codigo: v.codigo,
    yacimiento_id: idPorCodigo.get(v.yacimiento_codigo)!,
    anio: v.anio,
    correlativo: v.correlativo,
    perf_inicio: v.perf_inicio,
    perf_fin: v.perf_fin,
    pozos: v.pozos,
    metros_por_pozo: v.metros_por_pozo,
    perf_tramos,
    densidad_t_m3: v.densidad_t_m3,
    burden_m: v.vol_burden_m, // la de diseño la prellena el editor; acá lo que trajo la planilla
    espaciamiento_m: v.vol_espaciamiento_m,
    perf_precio_usd_m: v.perf_precio_usd_m,
    perf_tc_usd: v.perf_tc_usd,
    perf_odoo_ref: v.perf_odoo_ref,
    vol_fecha_carga: v.vol_fecha_carga,
    vol_fecha: v.vol_fecha,
    vol_pozos: v.vol_pozos,
    vol_metros_por_pozo: v.vol_metros_por_pozo,
    vol_burden_m: v.vol_burden_m,
    vol_espaciamiento_m: v.vol_espaciamiento_m,
    vol_tc_usd: v.vol_tc_usd,
    vol_odoo_ref: v.vol_odoo_ref,
    explosivos_raw: v.explosivos_raw,
    toneladas_planilla: v.toneladas_planilla,
    observaciones: v.observaciones,
    origen: "importacion",
    cargado_por: null,
  };
}

const { data: volIns, error: errVol } = await sb
  .from("cantera_voladuras")
  .upsert(voladuras.map(paraInsert), { onConflict: "codigo", ignoreDuplicates: true })
  .select("codigo");
if (errVol) throw errVol;
const insertadas = new Set((volIns ?? []).map((r) => r.codigo as string));
console.log(`\nVoladuras insertadas: ${insertadas.size} (${voladuras.length - insertadas.size} ya estaban)`);

const { data: bochIns, error: errBoch } = await sb
  .from("cantera_bochones")
  .upsert(
    bochones.map((b) => ({
      codigo: b.codigo,
      yacimiento_id: idPorCodigo.get(b.yacimiento_codigo)!,
      anio: b.anio,
      correlativo: b.correlativo,
      voladura_codigo: b.voladura_codigo,
      inicio: b.inicio,
      fin: b.fin,
      pozos: b.pozos,
      metros_perforados: b.metros_perforados,
      precio_usd_m: b.precio_usd_m,
      tc_usd: b.tc_usd,
      odoo_ref: b.odoo_ref,
      observaciones: b.observaciones,
      origen: "importacion",
      cargado_por: null,
    })),
    { onConflict: "codigo", ignoreDuplicates: true }
  )
  .select("codigo");
if (errBoch) throw errBoch;
console.log(`Bochones insertados: ${(bochIns ?? []).length}`);

// Consumos: sólo los de voladuras recién insertadas, para no duplicar en re-corridas.
const consumosNuevos = consumos.filter((c) => insertadas.has(c.voladura_codigo));
if (consumosNuevos.length > 0) {
  const { error: errCons } = await sb.from("cantera_consumos").insert(
    consumosNuevos.map((c) => ({
      voladura_codigo: c.voladura_codigo,
      insumo_id: null,
      insumo_raw: c.insumo_raw,
      tipo: c.tipo,
      cantidad: c.cantidad,
      precio_usd: c.precio_usd,
      orden: c.orden,
    }))
  );
  if (errCons) throw errCons;
}
console.log(`Consumos insertados: ${consumosNuevos.length}`);
console.log("\nListo.");
