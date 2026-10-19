// Los sectores de planta, acomodados a lo que la planilla de OT ya escribe.
//
// POR QUÉ
//
// La columna SECTOR de la planilla la llena un formulario de Google con una
// lista fija, y esa lista usa nombres largos: "Planta filler 1", "Planta de
// trituración 1", "Molienda de cal", "Planta 0-2 mm". El catálogo del SdG
// tenía los cortos: "Filler 1", "Trituración 1", "Molienda cal", "Planta 02".
//
// El enlace de la sincronización busca el sector **por nombre** cuando la fila
// no trae un equipo que lo diga (`lib/mantenimiento/enlaces.ts`), así que esos
// nombres distintos no eran cosmética: medido el 19/10/2026, **184 órdenes
// estaban sin sector**, y las cuatro causas eran éstas —
//
//    99  "Servicios auxiliares"  → el sector no existía
//    29  "Taller"                → no existía
//    29  "Planta filler 1"       → el SdG lo llamaba "Filler 1"
//    26  "Planta filler 2"       → lo llamaba "Filler 2"
//     1  (vacío)
//
// Esto crea los dos que faltaban y renombra los ocho que no coincidían. La
// próxima sincronización vuelve a leer la planilla y les pone el sector a las
// 183: no hay que tocar las órdenes a mano.
//
// POR QUÉ NO LLEVAN CÓDIGO LOS DOS NUEVOS
//
// `sectores.codigo` —PO-A1, AMB-C1— sale del libro BD Equipos, y "Servicios
// auxiliares" y "Taller" no tienen equipos ahí. Inventarles uno sería escribir
// un dato que dice venir de un lugar del que no viene. Quedan en null, igual
// que "Cantera", que es el precedente. El costo es que el desplegable los
// muestra al final, porque ordena por código y los nulos van últimos.
//
// LO QUE NO TOCA
//
// **"Despacho cal" se queda.** No está en la lista del formulario, pero tiene
// 7 equipos y 39 órdenes: esa lista dice *quién solicita* y el catálogo dice
// *dónde está la máquina*, que no son lo mismo. Sacarlo de los de planta lo
// borraría de los filtros de Mantenimiento y dejaría esas 39 sin poder
// filtrarse.
//
// Y no borra ningún sector: `sectores` es un catálogo del núcleo que comparten
// los seis módulos, y de un módulo no se borra.
//
// Uso:
//   npx tsx scripts/sectores-de-la-ot.mts            ← dice qué haría
//   npx tsx scripts/sectores-de-la-ot.mts --aplicar
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");

const APLICAR = process.argv.includes("--aplicar");
const sb = createAdminClient();

/** Cómo se llama hoy → cómo lo escribe la planilla. */
const RENOMBRES: Array<[viejo: string, nuevo: string]> = [
  ["Trituración 1", "Planta de trituración 1"],
  ["Trituración 2", "Planta de trituración 2"],
  ["Trituración 3", "Planta de trituración 3"],
  ["Filler 1", "Planta filler 1"],
  ["Filler 2", "Planta filler 2"],
  ["Filler 3", "Planta filler 3"],
  ["Molienda cal", "Molienda de cal"],
  ["Planta 02", "Planta 0-2 mm"],
];

/**
 * Los que faltaban. Transversales y sin empresa, como Compresores y Equipos
 * móviles: sirven a las dos plantas.
 */
const NUEVOS = ["Servicios auxiliares", "Taller"];

type Sector = { id: string; nombre: string; es_de_planta: boolean; codigo: string | null };

const { data: antes, error } = await sb.from("sectores").select("id, nombre, es_de_planta, codigo");
if (error) throw new Error(error.message);
const porNombre = new Map((antes as Sector[]).map((s) => [s.nombre, s]));

/* ── Qué haría ──────────────────────────────────────────────────────────── */

const aRenombrar = RENOMBRES.filter(([viejo]) => porNombre.has(viejo));
const yaRenombrados = RENOMBRES.filter(([, nuevo]) => porNombre.has(nuevo));
const aCrear = NUEVOS.filter((n) => !porNombre.has(n));

console.log(`Sectores hoy: ${antes.length} · de planta: ${(antes as Sector[]).filter((s) => s.es_de_planta).length}\n`);

for (const [viejo, nuevo] of aRenombrar) console.log(`  renombrar  "${viejo}" → "${nuevo}"`);
for (const [, nuevo] of yaRenombrados) console.log(`  ya estaba  "${nuevo}"`);
for (const n of aCrear) console.log(`  crear      "${n}" (de planta, transversal, sin código)`);
for (const n of NUEVOS.filter((n) => porNombre.has(n))) console.log(`  ya estaba  "${n}"`);

// Un renombre que choca con un sector que ya existe no se hace: dos filas con
// el mismo nombre es lo que deja al enlace eligiendo cualquiera de las dos.
const choques = aRenombrar.filter(([, nuevo]) => porNombre.has(nuevo));
if (choques.length > 0) {
  console.log(`\nNo se renombra nada: ya hay un sector llamado ${choques.map(([, n]) => `"${n}"`).join(", ")}.`);
  process.exit(1);
}

if (!APLICAR) {
  console.log(`\nNo se escribió nada. Con --aplicar: ${aRenombrar.length} renombres y ${aCrear.length} altas.`);
  process.exit(0);
}

/* ── Aplicar ────────────────────────────────────────────────────────────── */

for (const [viejo, nuevo] of aRenombrar) {
  const { error } = await sb.from("sectores").update({ nombre: nuevo }).eq("id", porNombre.get(viejo)!.id);
  if (error) throw new Error(`renombrando "${viejo}": ${error.message}`);
  console.log(`  ✓ "${viejo}" → "${nuevo}"`);
}

if (aCrear.length > 0) {
  const { error } = await sb.from("sectores").insert(
    aCrear.map((nombre) => ({
      nombre,
      es_de_planta: true,
      transversal: true,
      empresa_id: null,
      codigo: null,
      activo: true,
      status: "ACTIVA",
    }))
  );
  if (error) throw new Error(`creando los sectores nuevos: ${error.message}`);
  for (const n of aCrear) console.log(`  ✓ creado "${n}"`);
}

/* ── Qué quedó ──────────────────────────────────────────────────────────── */

const { data: despues } = await sb
  .from("sectores").select("nombre, codigo").eq("es_de_planta", true).order("codigo");
console.log(`\nSectores de planta ahora: ${despues?.length}`);
for (const s of despues ?? []) console.log(`  ${(s.codigo ?? "—").padEnd(8)} ${s.nombre}`);
console.log(
  "\nLas órdenes sin sector se re-enlazan solas en la próxima sincronización,\n" +
  "que corre cada quince minutos."
);
