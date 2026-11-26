// Qué haría la próxima corrida con el ciclo de PO-C1-04, que está frenado.
// **No escribe nada.** Corre las funciones de verdad sobre las filas de verdad.
//
//   npx tsx scripts/simular-po-c1-04.mts
//
// Existe porque `que-haria-el-ciclo.mts` sólo mira los ciclos activos, y éste
// se puso inactivo para cortar la generación en loop del 20 al 24/11/2026.

// El `.env.local` se lee acá y nunca pasa por el shell: exportarlo con
// `set -a; . <(grep …)` rompe el JSON de la cuenta de servicio y el error lo
// imprime entero, clave privada incluida. Pasó el 24/11/2026.
import { readFileSync, existsSync } from "node:fs";
const env = process.env.ENV_PATH ?? new URL("../.env.local", import.meta.url).pathname;
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { queSigueEnElCiclo, elCorteQueSigue } = await import("../lib/mantenimiento/cicloDeOT.ts");

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!URL_BASE || !KEY) throw new Error("Falta la URL de Supabase o la service role key");

const pedir = async <T>(path: string): Promise<T> => {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(body)}`);
  return body as T;
};

const ciclos = await pedir<Array<Record<string, unknown>>>(
  "mant_ciclos_de_ot?select=id,repeticiones,desde,vuelta_desde,activo," +
  "equipos:equipment_id(code),hija:tarea_hija_id(periodo_dias)"
);
const c = ciclos.find((x) => (x.equipos as { code?: string } | null)?.code === "PO-C1-04");
if (!c) throw new Error("no está el ciclo de PO-C1-04");

const ots = await pedir<Array<Record<string, unknown>>>(
  `ordenes_trabajo?select=ot_number,ciclo_vuelta,estado,fecha_cierre,fecha_ejecucion,created_at_app` +
  `&ciclo_id=eq.${c.id}&limit=2000`
);

const paraDecidir = {
  id: String(c.id),
  repeticiones: Number(c.repeticiones),
  periodo_dias: (c.hija as { periodo_dias?: number | null } | null)?.periodo_dias ?? null,
  desde: (c.desde as string | null) ?? null,
  vuelta_desde: (c.vuelta_desde as number | null) ?? null,
};

console.log(`PO-C1-04 · activo=${c.activo} · ${ots.length} OT · desde=${paraDecidir.desde} vuelta_desde=${paraDecidir.vuelta_desde}`);

const corte = elCorteQueSigue(paraDecidir, ots as never);
console.log("corte que seguiría:", corte ?? "ninguno");
if (corte) { paraDecidir.desde = corte.desde; paraDecidir.vuelta_desde = corte.vuelta_desde; }

console.log("decisión:", queSigueEnElCiclo(paraDecidir, ots as never));
