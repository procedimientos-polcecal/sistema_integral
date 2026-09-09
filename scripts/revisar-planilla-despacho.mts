// Los renglones de la planilla que alguien tiene que mirar, con pestaña y fila.
//
// El importador informa cuántos hay; esto dice **cuáles**, y es lo que hace
// falta para ir a arreglarlos al libro. Sólo lee.
//
// Uso: npx tsx scripts/revisar-planilla-despacho.mts
import { readFileSync } from "node:fs";
import { leerValores, listarPestanas } from "../lib/core/sheets.ts";
import { indicesDeColumnas, ordenDeFilaDePlanilla } from "../lib/despacho/importar.ts";
import { pestanaDelMes } from "../lib/despacho/planilla.ts";
import { tiemposDeLaOrden } from "../lib/despacho/orden.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
const LIBRO =
  process.env.GOOGLE_SHEETS_DESPACHO_ID || "1jF2lqDn_9H_BRQ8TQFNopfappOPyMGCQwFsGkWSkonM";

interface Renglon {
  numero: string;
  fecha: string;
  cliente: string | null;
  material: string | null;
  pestana: string;
  fila: number;
  entrada: string | null;
  inicio: string | null;
  fin: string | null;
  salida: string | null;
  carga: number | null;
  predio: number | null;
}

const todos: Renglon[] = [];

for (const pestana of await listarPestanas(LIBRO)) {
  const valores = await leerValores(LIBRO, pestana, { sinFormato: true });
  const idx = indicesDeColumnas(valores[0] ?? []);
  if (!idx) { console.log(`${pestana}: encabezados no reconocidos`); continue; }

  for (let i = 1; i < valores.length; i++) {
    const o = ordenDeFilaDePlanilla(valores[i] ?? [], idx);
    if (!o) continue;
    const t = tiemposDeLaOrden(o);
    todos.push({
      numero: o.numero, fecha: o.fecha, cliente: o.cliente_raw, material: o.producto_raw,
      pestana, fila: i + 1,
      entrada: o.entrada_predio, inicio: o.inicio_carga, fin: o.fin_carga, salida: o.salida_predio,
      carga: t.carga, predio: t.predio,
    });
  }
}

console.log(`${todos.length} renglones en el libro.\n`);

// ── 1. Números repetidos, con las dos ubicaciones ────────────
const porNumero = new Map<string, Renglon[]>();
for (const r of todos) {
  const l = porNumero.get(r.numero) ?? [];
  l.push(r);
  porNumero.set(r.numero, l);
}
const repetidos = [...porNumero.entries()].filter(([, l]) => l.length > 1);

console.log(`═══ Nº de orden repetidos (${repetidos.length}) ═══`);
console.log("El Nº del talonario es único, así que cada uno es un renglón de más");
console.log("o un número mal copiado. El importador se queda con el primero.\n");
for (const [numero, filas] of repetidos.sort((a, b) => a[0].localeCompare(b[0]))) {
  const igualitos = filas.every(
    (f) => f.fecha === filas[0].fecha && f.cliente === filas[0].cliente && f.material === filas[0].material
  );
  console.log(`  Nº ${numero}${igualitos ? "   (las dos filas dicen lo mismo: sobra una)" : "   (las filas DIFIEREN: hay que decidir)"}`);
  for (const f of filas) {
    console.log(`     ${f.pestana} fila ${String(f.fila).padStart(4)}  ${f.fecha}  ${String(f.cliente).padEnd(22)} ${f.material}`);
  }
}

// ── 2. Renglones en la pestaña que no les toca ───────────────
const desalineados = todos.filter((r) => pestanaDelMes(r.fecha) !== r.pestana);
console.log(`\n═══ Renglones en la pestaña equivocada (${desalineados.length}) ═══`);
console.log("Su fecha no es del mes de la hoja donde están. Entran al sistema sin");
console.log("fila de planilla, así que corregirlos desde el sistema agrega un renglón\n");
for (const r of desalineados) {
  const rep = (porNumero.get(r.numero) ?? []).length > 1 ? "  ← y además está repetido" : "";
  console.log(`  ${r.pestana} fila ${r.fila}: Nº ${r.numero}  ${r.fecha}  ${r.cliente}  → iría a "${pestanaDelMes(r.fecha)}"${rep}`);
}

// ── 3. Tiempos que no pueden ser ─────────────────────────────
//
// Se parten en dos porque el arreglo es distinto: un negativo son dos horarios
// escritos al revés, y uno larguísimo es un horario en la columna equivocada o
// con la hora cambiada. Van con los cuatro horarios a la vista: sin verlos no
// se puede saber cuál está mal.

/** "10:20", en hora de Argentina. */
const hhmm = (iso: string | null) => {
  if (!iso) return "  —  ";
  const t = new Date(iso).getTime() - 3 * 60 * 60 * 1000;
  return new Date(t).toISOString().slice(11, 16);
};
const min = (n: number | null) => (n === null ? "    —" : String(Math.round(n)).padStart(5));

function tabla(titulo: string, filas: Renglon[], porque: string) {
  console.log(`\n═══ ${titulo} (${filas.length}) ═══`);
  console.log(porque);
  console.log("\n  pestaña        fila   Nº        entra  inicio    fin  salida    carga   predio  cliente");
  for (const r of filas) {
    console.log(
      `  ${r.pestana.replace(" 2026", "").padEnd(11)} ${String(r.fila).padStart(5)}  ${r.numero.padEnd(8)}` +
        ` ${hhmm(r.entrada)} ${hhmm(r.inicio)} ${hhmm(r.fin)} ${hhmm(r.salida)}  ${min(r.carga)}min ${min(r.predio)}min  ${r.cliente}`
    );
  }
}

const negativos = todos
  .filter((r) => (r.carga !== null && r.carga < 0) || (r.predio !== null && r.predio < 0))
  .sort((a, b) => Math.min(a.carga ?? 0, a.predio ?? 0) - Math.min(b.carga ?? 0, b.predio ?? 0));

const largos = todos
  .filter((r) => !negativos.includes(r))
  .filter((r) => (r.carga !== null && r.carga > 360) || (r.predio !== null && r.predio > 720))
  .sort((a, b) => (b.predio ?? b.carga ?? 0) - (a.predio ?? a.carga ?? 0));

tabla(
  "Horarios anotados al revés",
  negativos,
  "Un horario cae antes del que lo precede por menos de 12 h, así que es un\nerror de tipeo y no un cruce de medianoche. El sistema los muestra en rojo."
);

tabla(
  "Tiempos que no pueden ser",
  largos,
  "Más de 6 h de carga o 12 h en predio. Casi siempre es un horario puesto en\nla columna de al lado, o con la hora cambiada."
);

console.log(`\nTotal a revisar: ${negativos.length + largos.length} renglones de ${todos.length}.`);
