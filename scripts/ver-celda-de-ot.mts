// Qué dice de verdad la celda de fecha de una OT, en los dos libros. **Sólo lee.**
//
// Existe para contestar una pregunta que `contrastar-ot` no puede: cuando el
// sistema y la planilla discrepan en una fecha, ¿la celda está mal escrita o
// está bien y la leemos mal? El contraste lee la planilla con `fechaDeSheets`,
// así que si el que pierde el día fuera el lector, el informe diría "planilla:
// X" mostrando algo que la celda no dice. Acá se imprime el serial crudo y
// además el texto formateado, que son las dos cosas que lo distinguen.
//
// Uso:
//   npx tsx scripts/ver-celda-de-ot.mts 2896 2897 2898

import { readFileSync, existsSync } from "node:fs";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { leerValores } = await import("../lib/core/sheets.ts");
const { serialDelDia, fechaDeSheets } = await import("../lib/core/fechaDeSheets.ts");

const numeros = process.argv.slice(2).map(Number).filter(Number.isFinite);
if (numeros.length === 0) throw new Error("Pasá los números de OT a mirar");

// Son DOS libros y no uno: el master `ORDEN DE TRABAJO` y el de respuestas del
// formulario, donde vive «Altas del sistema». (El cuadro de
// `docs/VARIABLES-VERCEL.md` dice que comparten id; no es así.)
const libroMaster = process.env.GOOGLE_SHEETS_OT_ID ?? "";
const master = process.env.GOOGLE_SHEETS_OT_TAB ?? "OT";
const libroAltas = process.env.GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID ?? "";
const altas = "Altas del sistema";
if (!libroMaster) throw new Error("Falta GOOGLE_SHEETS_OT_ID");
if (!libroAltas) throw new Error("Falta GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID");

/** La columna J del master es la fecha de ejecución (A = 0). */
const COL_EJECUCION_MASTER = 9;

const [crudoMaster, textoMaster, crudoAltas, textoAltas] = await Promise.all([
  leerValores(libroMaster, master, { sinFormato: true }),
  leerValores(libroMaster, master),
  leerValores(libroAltas, altas, { sinFormato: true }),
  leerValores(libroAltas, altas),
]);

/** En qué columna de «Altas del sistema» está la fecha, por su encabezado. */
const encabezadoAltas = (crudoAltas[0] ?? []).map((c) => String(c ?? "").toUpperCase());
const colFechaAltas = encabezadoAltas.findIndex((c) => c.includes("FECHA"));

console.log(`Encabezado de «${altas}» en la columna de fecha: ${colFechaAltas} → ${encabezadoAltas[colFechaAltas]}`);
console.log(`Encabezado del master en la columna ${COL_EJECUCION_MASTER}: ${String((crudoMaster[0] ?? [])[COL_EJECUCION_MASTER] ?? "")}`);

const buscar = (filas: string[][], numero: number) =>
  filas.findIndex((f, i) => i > 0 && Number(String(f[0] ?? "").trim()) === numero);

for (const n of numeros) {
  console.log(`\n── OT ${n} ──`);

  const iM = buscar(crudoMaster, n);
  if (iM < 0) console.log("   master: no está");
  else {
    const crudo = crudoMaster[iM]?.[COL_EJECUCION_MASTER];
    console.log(`   master   fila ${iM + 1}  serial crudo: ${JSON.stringify(crudo)}  ` +
      `formateado: ${JSON.stringify(textoMaster[iM]?.[COL_EJECUCION_MASTER])}  ` +
      `lo que leemos: ${fechaDeSheets(crudo)}`);
  }

  const iA = buscar(crudoAltas, n);
  if (iA < 0) console.log("   altas: no está");
  else {
    const crudo = crudoAltas[iA]?.[colFechaAltas];
    console.log(`   altas    fila ${iA + 1}  serial crudo: ${JSON.stringify(crudo)}  ` +
      `formateado: ${JSON.stringify(textoAltas[iA]?.[colFechaAltas])}  ` +
      `lo que leemos: ${fechaDeSheets(crudo)}`);
  }
}

console.log(`\nDe referencia: serialDelDia("2026-11-02") = ${serialDelDia("2026-11-02")} · ` +
  `serialDelDia("2026-11-03") = ${serialDelDia("2026-11-03")}`);
