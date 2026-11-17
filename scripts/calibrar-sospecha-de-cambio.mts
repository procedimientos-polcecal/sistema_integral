// Calibra `pareceUnCambio` contra las descripciones reales de los cuatro
// equipos del ciclo de martillos. No escribe nada: imprime qué marcaría.
//
// Existe porque un matcher de texto sólo se puede juzgar contra el texto de
// verdad. Los tests fijan los casos conocidos; esto muestra los que no.
//
//   npx tsx scripts/calibrar-sospecha-de-cambio.mts

import { readFileSync, existsSync } from "node:fs";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { pareceUnCambio } = await import("../lib/mantenimiento/sospechaDeCambio.ts");

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!URL_BASE || !KEY) throw new Error("Falta la URL de Supabase o la service role key");

const DEL_CICLO = ["PO-C1-04", "PY-B1-06", "PY-A1-05", "PY-C1-03"];

const res = await fetch(
  `${URL_BASE}/rest/v1/ordenes_trabajo?select=ot_number,equipo_raw,descripcion,fecha_cierre` +
  `&descripcion=ilike.*martillo*&limit=1000`,
  { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
);
const todas = (await res.json()) as {
  ot_number: number; equipo_raw: string | null; descripcion: string | null; fecha_cierre: string | null;
}[];

const filas = todas.filter((o) => DEL_CICLO.some((c) => String(o.equipo_raw ?? "").startsWith(c)));

const marcadas = filas.filter((o) => pareceUnCambio(o.descripcion, "Martillos"));
const limpio = (s: string | null) => String(s ?? "").replace(/\s+/g, " ").slice(0, 78);

console.log(`${filas.length} OT de martillos en los cuatro equipos del ciclo`);
console.log(`${marcadas.length} las marcaria como «cambio»  (${Math.round(marcadas.length / filas.length * 100)} %)\n`);

console.log("── MARCADAS ─────────────────────────────────────────────");
for (const o of marcadas) console.log(`  ${String(o.ot_number).padStart(5)} · ${limpio(o.descripcion)}`);

console.log("\n── NO MARCADAS QUE NOMBRAN UN CAMBIO ────────────────────");
console.log("   (si alguna de estas es un cambio de martillos de verdad, el regex se lo pierde)");
const sospechosas = filas.filter(
  (o) => !pareceUnCambio(o.descripcion, "Martillos") && /cambi|coloca|nuevo/i.test(o.descripcion ?? "")
);
for (const o of sospechosas) console.log(`  ${String(o.ot_number).padStart(5)} · ${limpio(o.descripcion)}`);
console.log(`\n   ${sospechosas.length} para mirar a ojo.`);
