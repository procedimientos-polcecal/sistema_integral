// Agregar a `equipos_componentes` lo que las OT nombran y el catálogo no tiene.
//
// **Por defecto NO escribe**: imprime lo que haría. Para aplicarlo, `--aplicar`.
//
// POR QUÉ EXISTE
//
// El catálogo de tareas preventivas (12/11/2026) llegó a 156 de 1.465 órdenes
// —el 11 %— porque `equipos_componentes` y las descripciones de las OT hablan
// idiomas distintos: el catálogo nombra piezas de relevamiento y las órdenes
// nombran lo que se toca ese día. Péndulos, grillas, rodamientos y correas son
// el segundo, tercero y cuarto objeto más frecuente de todo el preventivo y no
// existen como componente.
//
// POR QUÉ ESTO NO ES INVENTAR UN CATÁLOGO
//
// Porque **qué equipo tiene qué componente sale del historial, no de una
// opinión**: cada OT que nombra «péndulos» ya viene con su `equipment_id`. Lo
// único que hace este script es leer esa evidencia y escribirla donde
// corresponde. No hay ninguna regla del tipo "un molino seguramente tiene".
//
// LAS TRES REGLAS QUE LO MANTIENEN HONESTO
//
//   1. **Los «Edificio» quedan afuera.** Son el equipo comodín al que se le
//      imputa lo que no tiene máquina —de ahí salieron las 10 OT de tableros
//      del 05/11—, y un edificio no tiene correas ni rodamientos. Sin este
//      filtro, «PO-D1 – Edificio» se lleva correas y mangas.
//   2. **Hacen falta dos órdenes, o una preventiva.** Una mención suelta en
//      una correctiva puede estar nombrando la pieza de la máquina de al lado;
//      una tarea planificada que la nombra es evidencia de que esa máquina la
//      tiene y se le hace mantenimiento.
//   3. **No se pisa lo que ya está.** Si el equipo ya tiene un componente con
//      ese nombre, no se toca: el relevamiento de agosto manda sobre esto.
//
// CÓMO SE DESHACE
//
// Las filas que escribe llevan `componente_id` con prefijo **`COMP-OT-`**, en
// vez de seguir la numeración `COMP-NNNN` del relevamiento. Es a propósito y
// es el mismo patrón que las claves `excel-21-10-26-NN` de Seguridad e
// Higiene: la procedencia va en la clave, así que se sabe de dónde salió cada
// fila y se puede sacar sin tocar ninguna otra.
//
//   delete from public.equipos_componentes where componente_id like 'COMP-OT-%';
//
// Uso:
//   npx tsx scripts/componentes-desde-las-ot.mts              ← dice qué haría
//   npx tsx scripts/componentes-desde-las-ot.mts --aplicar    ← lo escribe

import { readFileSync, existsSync } from "node:fs";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { traerTodo } = await import("../lib/core/paginado.ts");
const { accionDe, normalizar } = await import("../lib/mantenimiento/tareasPreventivas.ts");

const APLICAR = process.argv.includes("--aplicar");

/**
 * Lo que se agrega, con el nombre que va a tener en el catálogo.
 *
 * Son seis y no las quince que propone `npm run catalogo-de-tareas`, porque de
 * esa lista hay que sacar tres clases de palabra:
 *
 *   - las que nombran **una máquina** y no una pieza (motor, balanza);
 *   - las que no son un componente (carga, pérdida, giro, sistema);
 *   - las que **ya tienen un equivalente** en el catálogo. «Mangas» es el
 *     caso: `Membrana / lona porosa` es eso mismo, y agregarla sería partir en
 *     dos un componente que ya está.
 *
 * El plural sigue al catálogo, que ya usa «Martillos» y «Cangilones».
 */
const CANDIDATOS: { nombre: string; reconoce: RegExp }[] = [
  { nombre: "Péndulos",    reconoce: /\bpendulos?\b/ },
  { nombre: "Grillas",     reconoce: /\bgrillas?\b/ },
  { nombre: "Rodamientos", reconoce: /\brodamientos?\b|\brulemanes?\b|\bruleman\b/ },
  { nombre: "Correas",     reconoce: /\bcorreas?\b/ },
  { nombre: "Reductor",    reconoce: /\breductor(es)?\b/ },
  { nombre: "Transmisión", reconoce: /\btransmision(es)?\b/ },
];

const admin = createAdminClient();

const ordenes = await traerTodo<{
  ot_number: number; tipo: string | null; descripcion: string | null; equipment_id: string | null;
}>((de, a) =>
  admin
    .from("ordenes_trabajo")
    .select("ot_number, tipo, descripcion, equipment_id")
    .not("equipment_id", "is", null)
    .order("ot_number")
    .range(de, a)
);

const equipos = await traerTodo<{ id: string; code: string | null; name: string | null }>((de, a) =>
  admin.from("equipos").select("id, code, name").order("code").range(de, a)
);
const equipoPorId = new Map(equipos.map((e) => [e.id, e]));

const yaEstan = await traerTodo<{ equipment_id: string; nombre: string; componente_id: string }>(
  (de, a) => admin.from("equipos_componentes").select("equipment_id, nombre, componente_id").range(de, a)
);
const yaTiene = new Set(yaEstan.map((c) => `${c.equipment_id}|${normalizar(c.nombre)}`));

/** El comodín del catálogo: lo que no tiene máquina se imputa ahí. */
const esEdificio = (e: { name: string | null }) => /edificio/i.test(e.name ?? "");

type Evidencia = { total: number; preventivas: number; ots: number[] };
const porComponente = new Map<string, Map<string, Evidencia>>();

for (const candidato of CANDIDATOS) {
  const porEquipo = new Map<string, Evidencia>();
  for (const orden of ordenes) {
    if (!candidato.reconoce.test(normalizar(orden.descripcion))) continue;
    const equipo = equipoPorId.get(orden.equipment_id!);
    if (!equipo || esEdificio(equipo)) continue;

    const suyo = porEquipo.get(orden.equipment_id!) ?? { total: 0, preventivas: 0, ots: [] };
    suyo.total += 1;
    if (orden.tipo === "PROGRAMADO" && accionDe(orden.descripcion)?.esPreventiva) {
      suyo.preventivas += 1;
    }
    if (suyo.ots.length < 4) suyo.ots.push(orden.ot_number);
    porEquipo.set(orden.equipment_id!, suyo);
  }
  porComponente.set(candidato.nombre, porEquipo);
}

/** Dos órdenes, o una preventiva. Lo explica el encabezado. */
const alcanza = (e: Evidencia) => e.total >= 2 || e.preventivas >= 1;

const aEscribir: { equipment_id: string; nombre: string; evidencia: Evidencia }[] = [];
const flojas: { equipment_id: string; nombre: string; evidencia: Evidencia }[] = [];

for (const [nombre, porEquipo] of porComponente) {
  for (const [equipment_id, evidencia] of porEquipo) {
    if (yaTiene.has(`${equipment_id}|${normalizar(nombre)}`)) continue;
    (alcanza(evidencia) ? aEscribir : flojas).push({ equipment_id, nombre, evidencia });
  }
}

aEscribir.sort(
  (a, b) =>
    a.nombre.localeCompare(b.nombre) ||
    (equipoPorId.get(a.equipment_id)?.code ?? "").localeCompare(equipoPorId.get(b.equipment_id)?.code ?? "")
);

const comoSeVe = (id: string) => {
  const e = equipoPorId.get(id);
  return e ? `${e.code} – ${e.name}` : id;
};

console.log(`Catálogo hoy: ${yaEstan.length} componentes en ${new Set(yaEstan.map((c) => c.equipment_id)).size} equipos`);
console.log(`Órdenes leídas: ${ordenes.length}\n`);

let anterior = "";
for (const fila of aEscribir) {
  if (fila.nombre !== anterior) {
    const cuantos = aEscribir.filter((f) => f.nombre === fila.nombre).length;
    console.log(`\n${fila.nombre} — ${cuantos} equipos`);
    anterior = fila.nombre;
  }
  const prev = fila.evidencia.preventivas;
  console.log(
    `  ${comoSeVe(fila.equipment_id).padEnd(42)} ${String(fila.evidencia.total).padStart(3)} OT` +
      `${prev > 0 ? ` (${prev} preventiva${prev === 1 ? "" : "s"})` : ""}` +
      `   OT ${fila.evidencia.ots.join(", ")}`
  );
}

console.log(`\n── Resumen ──`);
console.log(`  filas a agregar: ${aEscribir.length}`);
console.log(`  descartadas por evidencia floja (una sola mención correctiva): ${flojas.length}`);

if (!APLICAR) {
  console.log(`\nNo se escribió nada. Para aplicarlo: --aplicar`);
  process.exit(0);
}

// El código sigue su propia numeración, con prefijo, para poder deshacerlo.
const usados = yaEstan
  .map((c) => Number(/^COMP-OT-(\d+)$/.exec(c.componente_id)?.[1] ?? 0))
  .filter((n) => n > 0);
let siguiente = (usados.length > 0 ? Math.max(...usados) : 0) + 1;

const filas = aEscribir.map((f) => ({
  equipment_id: f.equipment_id,
  componente_id: `COMP-OT-${String(siguiente++).padStart(4, "0")}`,
  nombre: f.nombre,
}));

// De a lotes: un insert de 200 filas arma una URL que PostgREST acepta, pero
// el lote chico deja claro dónde se cortó si algo falla a la mitad.
let escritas = 0;
for (let i = 0; i < filas.length; i += 100) {
  const lote = filas.slice(i, i + 100);
  const { error } = await admin.from("equipos_componentes").insert(lote);
  if (error) {
    console.error(`\nFalló el lote que empieza en ${lote[0].componente_id}: ${error.message}`);
    console.error(`Escritas hasta acá: ${escritas}. Las que entraron se sacan con el delete del encabezado.`);
    process.exit(1);
  }
  escritas += lote.length;
}

console.log(`\nEscritas ${escritas} filas, de ${filas[0].componente_id} a ${filas[filas.length - 1].componente_id}.`);
console.log(`Para deshacerlo: delete from public.equipos_componentes where componente_id like 'COMP-OT-%';`);
