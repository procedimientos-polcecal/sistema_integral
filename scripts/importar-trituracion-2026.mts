// Importa los partes de 2026 ya cargados en la planilla real
// (PLANTA 1/2/3) a `trituracion_partes`. Se corre una vez.
//
// Usa las mismas funciones puras de `lib/trituracion/importar.ts` —no una
// copia—. Sin operario: el Excel nunca lo tuvo, así que los partes
// importados quedan con `operario_id`/`operario_raw` en null (se distinguen
// en pantalla de los cargados desde el SdG).
//
// Uso:
//   npx tsx scripts/importar-trituracion-2026.mts             # ensayo: lee y cuenta, no escribe
//   npx tsx scripts/importar-trituracion-2026.mts --escribir  # escribe
//
// Idempotente: inserta con `ignoreDuplicates` sobre `unique(planta_id,
// fecha)`, así que lo que ya está en el sistema (cargado desde el SdG) gana
// y volver a correrlo no lo pisa.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { leerValores } from "../lib/core/sheets.ts";
import { partesDe2026 } from "../lib/trituracion/importar.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const LIBRO =
  process.env.GOOGLE_SHEETS_TRITURACION_ID || "1QU1iDgcsTSwTe_RMzUs9DOJwfDV0H6ylR7ublMwcMdI";
const escribir = process.argv.includes("--escribir");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const { data: plantas, error: errPlantas } = await sb
  .from("trituracion_plantas")
  .select("id, codigo");
if (errPlantas) throw errPlantas;
const idPorCodigo = new Map<string, string>(
  (plantas ?? []).map((p) => [p.codigo as string, p.id as string])
);
console.log(`Plantas en el SdG: ${[...idPorCodigo.keys()].sort().join(", ")}`);

let totalPartes = 0;
let totalSaltadas = 0;

for (const codigo of ["1", "2", "3"]) {
  const plantaId = idPorCodigo.get(codigo);
  if (!plantaId) {
    console.log(`PLANTA ${codigo}: no existe en trituracion_plantas, se saltea la pestaña entera.`);
    continue;
  }

  const filas = await leerValores(LIBRO, `PLANTA ${codigo}`, { sinFormato: true });
  const { partes, saltadas } = partesDe2026(filas);
  console.log(`PLANTA ${codigo}: ${partes.length} partes de 2026 (${saltadas} filas sin dato real o fuera de 2026).`);
  totalPartes += partes.length;
  totalSaltadas += saltadas;

  if (!escribir) continue;
  if (partes.length === 0) continue;

  const filasAInsertar = partes.map((p) => ({ planta_id: plantaId, ...p }));
  const { error, count } = await sb
    .from("trituracion_partes")
    .upsert(filasAInsertar, { onConflict: "planta_id,fecha", ignoreDuplicates: true, count: "exact" });
  if (error) throw error;
  console.log(`  → insertados ${count ?? "?"} (los que ya existían, cargados desde el SdG, no se tocaron).`);
}

console.log(`\nTotal: ${totalPartes} partes de 2026 (${totalSaltadas} filas descartadas en las 3 pestañas).`);
if (!escribir) console.log("Ensayo: no se escribió nada. Corré con --escribir para aplicar.");
