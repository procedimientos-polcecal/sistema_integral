// ¿Dicen lo mismo el sistema y la planilla sobre cada OT? **Sólo lee.**
//
// POR QUÉ EXISTE
//
// El 21/10/2026 la OT 2845 tenía el 1/10 en el sistema y el 3/10 en la
// planilla, y 1 hora en el sistema contra una celda vacía allá. Se vio porque
// alguien lo miró; no había nada que lo detectara. Las seis comprobaciones del
// repo miran el código, y `npm run planillas` mira si una planilla se cayó por
// una fórmula — **ninguna mira si los dos lados dicen lo mismo**.
//
// Una divergencia así no avisa nunca: la OT se lee bien en los dos lados, sólo
// que dicen cosas distintas, y quien mira uno no mira el otro. Y hay un
// agravante: en cuanto una orden queda con `sheets_pendiente`, la importación
// **la saltea** a propósito, así que la diferencia se congela en vez de
// resolverse en la próxima corrida.
//
// QUÉ NO HACE
//
// **No arregla nada.** No se sabe cuál de los dos lados tiene razón: la
// planilla manda en este módulo, pero una orden que nació en el sistema y
// todavía no exportó tiene la verdad del otro lado. Eso lo decide una persona.
//
// La decisión de qué es una divergencia y qué es normal vive en
// `lib/core/..`/`lib/mantenimiento/contraste.ts`, con sus tests; esto es sólo
// la lectura. Sale 1 si hay alguna divergencia.
//
// Uso:
//   npx tsx scripts/contrastar-ot.mts
//   npx tsx scripts/contrastar-ot.mts --todo   ← además lista las de un lado solo

import { readFileSync, existsSync } from "node:fs";

// El env antes que los módulos que lo leen, igual que `revisar-planillas.mts`.
const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { leerValores } = await import("../lib/core/sheets.ts");
const { filaDeOrden } = await import("../lib/mantenimiento/ordenes.ts");
const { contrastar, porOrden } = await import("../lib/mantenimiento/contraste.ts");
const { traerTodo } = await import("../lib/core/paginado.ts");

const TODO = process.argv.includes("--todo");

const planillaId = process.env.GOOGLE_SHEETS_OT_ID ?? "";
const pestana = process.env.GOOGLE_SHEETS_OT_TAB ?? "OT";
if (!planillaId) throw new Error("Falta GOOGLE_SHEETS_OT_ID");

// Sin formato: las fechas tienen que venir como serial, que es lo que
// `filaDeOrden` sabe leer. Formateadas llegan "3/10/2026" y se interpretan
// según el locale, que es la trampa que dio vuelta 885 fechas en Compras.
const filas = await leerValores(planillaId, pestana, { sinFormato: true });

const deLaPlanilla = [];
for (let i = 1; i < filas.length; i++) {
  const o = filaDeOrden(filas[i], i + 1);
  if (o) deLaPlanilla.push(o);
}

const admin = createAdminClient();
// `traerTodo` porque son 2.200 y PostgREST corta en 1.000 sin avisar.
const delSistema = await traerTodo((desde, hasta) =>
  admin
    .from("ordenes_trabajo")
    .select("ot_number, sector_raw, equipo_raw, especialidad, tipo, quien, descripcion, fecha_ejecucion, fecha_cierre, estado, contratista, horas, operario_1, operario_2, operario_3, prioridad, sheets_pendiente")
    .range(desde, hasta)
);

const r = contrastar(delSistema as never, deLaPlanilla);

console.log(
  `${delSistema.length} órdenes en el sistema · ${deLaPlanilla.length} en la planilla\n`
);

const agrupadas = porOrden(r.divergencias);
if (agrupadas.size === 0) {
  console.log("Ninguna orden dice cosas distintas en los dos lados.");
} else {
  console.log(`DICEN DISTINTO: ${agrupadas.size} ${agrupadas.size === 1 ? "orden" : "órdenes"}\n`);
  for (const [ot, lista] of [...agrupadas].sort((a, b) => b[0] - a[0])) {
    console.log(`  OT ${ot}`);
    for (const d of lista) {
      console.log(`     ${d.campo.padEnd(24)} sistema: ${d.enElSistema.padEnd(22)} planilla: ${d.enLaPlanilla}`);
    }
  }
  console.log();
}

// Lo que es normal, contado y no listado: son muchas y no hay nada que hacer
// con ellas salvo sincronizar. Con `--todo` se ven.
const resumen = [
  r.enLaCola.length && `${r.enLaCola.length} esperando exportar (sincronizá y se van)`,
  r.soloEnElSistema.length && `${r.soloEnElSistema.length} todavía no llegaron a la planilla`,
  r.soloEnLaPlanilla.length && `${r.soloEnLaPlanilla.length} todavía no se importaron`,
].filter(Boolean);
if (resumen.length) console.log(`Normal: ${resumen.join(" · ")}.`);

if (TODO) {
  const lista = (t: string, ns: readonly number[]) =>
    ns.length && console.log(`\n${t}: ${ns.join(", ")}`);
  lista("En la cola de exportación", r.enLaCola);
  lista("Sólo en el sistema", r.soloEnElSistema);
  lista("Sólo en la planilla", r.soloEnLaPlanilla);
}

process.exit(agrupadas.size > 0 ? 1 : 0);
