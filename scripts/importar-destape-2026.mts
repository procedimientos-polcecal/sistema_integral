// Importa la pestaña "Registro" de la planilla real de destape a
// `cantera_destape`. Se corre una vez.
//
// Uso:
//   npx tsx scripts/importar-destape-2026.mts             # ensayo: lee y cuenta, no escribe
//   npx tsx scripts/importar-destape-2026.mts --escribir  # escribe
//
// No es upsert: sin clave natural (dos recursos bien podrían compartir
// fecha+tipo+recurso), inserta sin más. Pensado para correr una vez sobre
// una tabla vacía — correrlo de nuevo duplicaría todo.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { leerValores } from "../lib/core/sheets.ts";
import { registrosDeDestape } from "../lib/cantera/importarDestape.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const LIBRO = "1SvF0HK3Zu6Mi5Z_tTokJAypWvHHHp9oEomucqJudE3Y";
const escribir = process.argv.includes("--escribir");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

if (escribir) {
  const { count, error } = await sb.from("cantera_destape").select("id", { count: "exact", head: true });
  if (error) throw error;
  if (count && count > 0) {
    console.log(`cantera_destape ya tiene ${count} filas — no es upsert, correrlo de nuevo duplicaría todo. Abortado.`);
    process.exit(1);
  }
}

const [{ data: fleteros }, { data: empleados }, { data: equipos }] = await Promise.all([
  sb.from("cantera_fleteros").select("id, nombre"),
  sb.from("empleados").select("id, nombre, apellido"),
  sb.from("equipos").select("id, code"),
]);

console.log(`Catálogos: ${fleteros?.length ?? 0} fleteros, ${empleados?.length ?? 0} empleados, ${equipos?.length ?? 0} equipos.`);

const filas = await leerValores(LIBRO, "Registro", { sinFormato: true });
const { registros, saltadas } = registrosDeDestape(filas, fleteros ?? [], empleados ?? [], equipos ?? []);

console.log(`\n${registros.length} registros de destape (${saltadas} filas sin dato real).`);
const sinFletero = registros.filter((r) => r.tipo_recurso === "fletero_externo" && !r.fletero_id).length;
const sinOperario = registros.filter((r) => r.tipo_recurso === "operario_propio" && !r.operario_id).length;
console.log(`  Fletero sin resolver (nombre ambiguo): ${sinFletero}`);
console.log(`  Operario sin resolver: ${sinOperario}`);
console.log(`  Sin yacimiento: ${registros.filter((r) => !r.yacimiento_codigo).length}`);

if (!escribir) {
  console.log("\nEnsayo: no se escribió nada. Corré con --escribir para aplicar.");
  process.exit(0);
}

const TAMANO_LOTE = 200;
let insertadas = 0;
for (let i = 0; i < registros.length; i += TAMANO_LOTE) {
  const lote = registros.slice(i, i + TAMANO_LOTE);
  const { error } = await sb.from("cantera_destape").insert(lote.map((r) => ({ ...r, origen: "sdg" })));
  if (error) throw new Error(`lote ${i}: ${error.message}`);
  insertadas += lote.length;
}
console.log(`\nListo: ${insertadas} registros insertados.`);
