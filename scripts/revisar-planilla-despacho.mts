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
      pestana, fila: i + 1, carga: t.carga, predio: t.predio,
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
const raros = todos
  .filter((r) => (r.carga !== null && (r.carga < 0 || r.carga > 360)) || (r.predio !== null && (r.predio < 0 || r.predio > 720)))
  .sort((a, b) => (b.predio ?? b.carga ?? 0) - (a.predio ?? a.carga ?? 0));

console.log(`\n═══ Horarios que no cierran (${raros.length}) ═══`);
console.log("Negativo = anotados al revés. Más de 6 h de carga o 12 h en predio =");
console.log("algún horario está mal. El sistema los muestra igual, en rojo.\n");
for (const r of raros.slice(0, 20)) {
  const f = (n: number | null) => (n === null ? "    —" : `${String(Math.round(n)).padStart(5)}`);
  console.log(`  ${r.pestana.padEnd(17)} fila ${String(r.fila).padStart(4)}  Nº ${r.numero.padEnd(8)} carga=${f(r.carga)} min  predio=${f(r.predio)} min  ${r.cliente}`);
}
if (raros.length > 20) console.log(`  … y ${raros.length - 20} más`);
