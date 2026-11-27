// Comprueba lo que contesta /api/mantenimiento/analisis, sin levantar la app.
//
// SOLO LEE la base de producción. Arma lo mismo que la ruta —las mismas
// columnas, las mismas funciones, en el mismo orden— e imprime los seis números
// de la semana 45 y de la actual, los tres totales de `necesitan` y cuántas
// reprogramaciones tiene cada semana. Si la tabla del historial todavía no
// existe (la migración la corre una persona), lo dice y sigue con el resto.
//
// Uso: npx tsx scripts/comprobar-analisis-de-ot.mts
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { hoyEnArgentina, sumarDias } from "../lib/core/fechas";
import {
  analizarLaSemana,
  lasQueNecesitanReprogramarse,
  type OrdenParaAnalisis,
} from "../lib/mantenimiento/analisisDeOt";

for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

// `reprogramada_veces` la crea la misma migración que la tabla del historial.
// Mientras nadie la corra, la columna no existe: se lee sin ella y se dice. La
// ruta NO hace este rodeo —lee la columna normalmente, como va a poder en
// cuanto se aplique la migración—.
const COLUMNAS =
  "id, ot_number, sector_raw, equipo_raw, tipo, descripcion, fecha_ejecucion, fecha_cierre, estado, app_created";
let conReprogramadaVeces = true;
const ordenes: OrdenParaAnalisis[] = [];
for (let desde = 0; ; desde += 1000) {
  let r = await db
    .from("ordenes_trabajo")
    .select(COLUMNAS + (conReprogramadaVeces ? ", reprogramada_veces" : ""))
    .order("id")
    .range(desde, desde + 999);
  if (r.error && conReprogramadaVeces && /reprogramada_veces/.test(r.error.message)) {
    console.log("la columna reprogramada_veces todavía no existe: se lee sin ella");
    conReprogramadaVeces = false;
    desde = -1000;
    ordenes.length = 0;
    continue;
  }
  if (r.error) throw new Error(r.error.message);
  const filas = (r.data ?? []) as unknown as Partial<OrdenParaAnalisis>[];
  ordenes.push(...filas.map((o) => ({ reprogramada_veces: 0, ...o }) as OrdenParaAnalisis));
  if (filas.length < 1000) break;
}
console.log(`ordenes_trabajo leídas: ${ordenes.length}`);

const hoy = hoyEnArgentina();
let fallo = false;

async function semana(titulo: string, dia: string) {
  const a = analizarLaSemana(ordenes, dia);
  const l = a.lasDiez;
  const suma = l.siguenAbiertas + l.cerraronDespues + l.cerraronAntes;
  console.log(`\n== ${titulo}: ${a.lunes} al ${a.domingo}`);
  console.log(`  con inicio ${a.conInicio} · cerradas dentro ${a.cerradasDentro} · cumplimiento ${
    a.cumplimiento === null ? "—" : (a.cumplimiento * 100).toFixed(1) + " %"
  }`);
  console.log(`  no cerraron ${a.noCerraron} · cerradas en la semana ${a.cerradasEnLaSemana} · correctivas ${a.correctivasCerradas}`);
  console.log(`  desglose: abiertas ${l.siguenAbiertas} + después ${l.cerraronDespues} + antes ${l.cerraronAntes} = ${suma} (sin fecha de cierre, dentro de "después": ${l.sinFechaDeCierre})`);
  if (suma !== a.noCerraron) {
    console.log("  MAL    el desglose no suma noCerraron");
    fallo = true;
  } else console.log("  OK     el desglose suma noCerraron");
  console.log(`  diagnóstico: ${a.diagnostico}`);

  const desdeI = `${a.lunes}T00:00:00-03:00`;
  const hastaI = `${sumarDias(a.domingo, 1)}T00:00:00-03:00`;
  const r = await db
    .from("mant_reprogramaciones_ot")
    .select("ot_id")
    .gte("creado_en", desdeI)
    .lt("creado_en", hastaI);
  if (r.error) {
    console.log(`  reprogramaciones: la tabla todavía no existe (${r.error.message})`);
  } else {
    const filas = r.data ?? [];
    console.log(`  reprogramaciones: ${filas.length} movimientos en ${new Set(filas.map((f) => f.ot_id)).size} OT`);
  }
}

await semana("Semana 45", "2026-11-05");
await semana("Semana actual", hoy);

const n = lasQueNecesitanReprogramarse(ordenes, hoy);
console.log(`\n== necesitan reprogramarse (contra hoy ${hoy}): ${n.length}`);
if (n.length) {
  console.log(`  más vencida: OT ${n[0].ot_number} (${n[0].fecha_ejecucion}) · menos vencida: OT ${n[n.length - 1].ot_number} (${n[n.length - 1].fecha_ejecucion})`);
  const porTipo = new Map<string, number>();
  for (const o of n) porTipo.set(o.tipo ?? "(sin tipo)", (porTipo.get(o.tipo ?? "(sin tipo)") ?? 0) + 1);
  console.log("  por tipo: " + [...porTipo].map(([t, c]) => `${t} ${c}`).join(" · "));
  console.log(`  del sistema (con Postergar): ${n.filter((o) => o.app_created).length}`);
}

process.exit(fallo ? 1 : 0);
