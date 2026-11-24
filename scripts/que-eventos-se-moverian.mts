// Dice qué eventos de la Agenda cambiarían de día por la regla «la OT que se
// cerró antes de empezar», sobre los datos de producción. No escribe nada.
//
// Es el gemelo de `comparar-franja-con-la-semana.mts` y existe por la misma
// razón: la decisión es pura y tiene tests, pero lo que la alimenta son dos
// consultas, y leer el modelo no alcanza para saber si las columnas que se
// piden son las que hay.
//
// Sólo mira los eventos cuya orden está cerrada **con el cierre adelantado**
// (`elCierreQueAdelanta`): una cerrada normal no se toca, aunque su evento y su
// fecha no coincidan, y listarla acá haría parecer que la excepción la agarra.
// Lo esperado el 24/11/2026 son siete —las OT 2970, 3096, 3097, 3122, 3149, 3152
// y 3162—, ninguno con más de un año de brecha y cero «no creíbles». Si da más,
// la excepción está agarrando órdenes que no debería.
//
//   npx tsx scripts/que-eventos-se-moverian.mts

import { readFileSync, existsSync } from "node:fs";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { elCierreQueAdelanta, laFechaQueMandaEnElEvento } = await import("../lib/agenda/evento.ts");
const { fechaDelEvento } = await import("../lib/agenda/elEventoSigueALaOT.ts");

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!URL_BASE || !KEY) throw new Error("Falta la URL de Supabase o la service role key");

interface Fila {
  id: string;
  inicio: string;
  ot_id: string;
  ordenes_trabajo: {
    ot_number: number | null;
    fecha_ejecucion: string | null;
    fecha_ejecucion_pendiente: string | null;
    fecha_cierre: string | null;
    estado: string | null;
  } | null;
}

// PostgREST corta en 1000 filas y no avisa: se pagina.
const filas: Fila[] = [];
const PAGINA = 1000;
for (let desde = 0; ; desde += PAGINA) {
  const ruta =
    `agenda_eventos?select=id,inicio,ot_id,ordenes_trabajo!ot_id(ot_number,fecha_ejecucion,fecha_ejecucion_pendiente,fecha_cierre,estado)` +
    `&ot_id=not.is.null&order=id`;
  const res = await fetch(`${URL_BASE}/rest/v1/${ruta}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${desde}-${desde + PAGINA - 1}` },
  });
  if (!res.ok) throw new Error(`${ruta}: ${res.status} ${await res.text()}`);
  const lote = (await res.json()) as Fila[];
  filas.push(...lote);
  if (lote.length < PAGINA) break;
}

const cambian: string[] = [];
const noCreibles: string[] = [];
let sinOrden = 0;

for (const f of filas) {
  const o = f.ordenes_trabajo;
  if (!o) { sinOrden++; continue; }
  const cierre = elCierreQueAdelanta(o);
  if (cierre === null) continue;
  const hoy = fechaDelEvento(f.inicio);
  if (cierre.tipo === "no-creible") {
    noCreibles.push(`OT ${o.ot_number}: cierre ${cierre.cierre}, inicio ${cierre.inicio}, ${cierre.dias} días`);
    continue;
  }
  const manda = laFechaQueMandaEnElEvento(o);
  if (manda && manda !== hoy) {
    const dias = Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${manda}T00:00:00Z`)) / 86_400_000);
    cambian.push(`OT ${o.ot_number}: ${hoy} -> ${manda} (${dias} días antes)`);
  }
}

console.log(`Eventos con ot_id: ${filas.length} (sin orden legible: ${sinOrden})`);
console.log(`\nSe moverían: ${cambian.length}`);
for (const c of cambian) console.log(`  ${c}`);
console.log(`\nCierre no creíble (sólo avisa, no mueve): ${noCreibles.length}`);
for (const c of noCreibles) console.log(`  ${c}`);
