// Trae de la planilla real de balanza/transporte los fleteros, las tarifas,
// las pesadas de "Datos" y las actividades sin pesada de "Ingreso de Datos".
// Envoltorio de línea de comandos de `lib/cantera/importarAcarreo.ts`, que es
// la misma lógica que corre sola cada 15-30 min desde
// `/api/cron/cantera-acarreo-sync` — este script sirve para ensayar sin
// escribir, o para forzar una corrida a mano.
//
// Uso:
//   npx tsx scripts/importar-acarreo-2026.mts             # ensayo: lee y cuenta, no escribe
//   npx tsx scripts/importar-acarreo-2026.mts --escribir  # escribe
import { readFileSync } from "node:fs";
import { sincronizarAcarreoDesdeSheets } from "../lib/cantera/importarAcarreo.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const escribir = process.argv.includes("--escribir");

const r = await sincronizarAcarreoDesdeSheets(escribir);

console.log("── Fleteros ──");
console.log(`  ${r.fleteros} fleteros en la base.`);

console.log("\n── Tarifas ──");
console.log(`  ${r.vigenciasDeTarifa} vigencias de tarifa ${escribir ? "insertadas" : "para insertar"}.`);
if (r.etiquetasSinTipo.length) console.log(`  Sin tipo en el vocabulario (se ignoran): ${r.etiquetasSinTipo.join(", ")}`);

console.log("\n── Pesadas ──");
console.log(`  ${r.pesadasLeidas} pesadas con material leídas de "Datos".`);
console.log(`  ${r.pesadasConFletero} con fletero reconocido, ${r.pesadasSinFletero} sin fletero (nombre ambiguo o desconocido).`);
if (escribir) console.log(`  ${r.pesadasInsertadas} insertadas (reemplazan lo que hubiera antes).`);

console.log("\n── Actividades manuales (Horas destape, Viaje de bloques, Hora bochones, Materiales Pezzuchi) ──");
console.log(`  ${r.actividadesInsertadas} renglones mensuales ${escribir ? "insertados" : "para insertar"}.`);
if (r.bloquesSinFletero.length) console.log(`  Bloques de fletero sin reconocer: ${r.bloquesSinFletero.join(" | ")}`);

console.log(escribir ? "\nListo, escrito." : "\nEnsayo: nada se escribió. Correr con --escribir para aplicar.");
