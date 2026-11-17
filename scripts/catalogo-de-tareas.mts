// ¿Qué tareas preventivas se repiten, y cada cuánto? **Sólo lee.**
//
// POR QUÉ EXISTE
//
// El motor de planes periódicos tiene **un plan cargado** y, al mismo tiempo,
// el 59,9 % de las OT del último año son PROGRAMADO: 1.455 órdenes escritas a
// mano una por una. Lo que falta no es una función, es el catálogo — y el
// catálogo no se puede inventar desde acá, porque quién tiene que hacer qué y
// cada cuánto es conocimiento de planta.
//
// Lo que sí se puede hacer, y es lo que hace esto, es **proponerlo con lo que
// ya se hizo**: cada tarea sale con cuántas veces se ejecutó, en qué equipos y
// con qué intervalo típico, que es exactamente lo que hay que mirar para
// decidir el período de un plan. Después lo confirma una persona.
//
// QUÉ NO HACE
//
// **No escribe nada.** Ni planes, ni órdenes, ni la clasificación de una OT.
// Una orden cargada como PROGRAMADO que en realidad fue una reparación sigue
// como está; lo único que pasa es que no entra al catálogo.
//
// La decisión de qué es una tarea y cómo se reconoce vive en
// `lib/mantenimiento/tareasPreventivas.ts`, con sus tests; esto es la lectura.
//
// Uso:
//   npm run catalogo-de-tareas
//   npm run catalogo-de-tareas -- --todas   ← lista todas, no las 30 primeras
//   npm run catalogo-de-tareas -- --sueltas ← además, las que no se reconocieron

import { readFileSync, existsSync } from "node:fs";

// El env antes que los módulos que lo leen, igual que `contrastar-ot.mts`.
const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { traerTodo } = await import("../lib/core/paginado.ts");
const { catalogoPropuesto, candidatasAComponente, accionDe, comoSeLee } = await import(
  "../lib/mantenimiento/tareasPreventivas.ts"
);

const TODAS = process.argv.includes("--todas");
const SUELTAS = process.argv.includes("--sueltas");

/** El mismo año que miran el MTBF y el MTTR, para que los tres hablen de lo mismo. */
const VENTANA_DIAS = 365;
const hoy = new Date();
const desde = new Date(hoy.getTime() - (VENTANA_DIAS - 1) * 86_400_000)
  .toISOString()
  .slice(0, 10);

const admin = createAdminClient();

// `ordenes_trabajo` pasa las 2.400 filas y PostgREST corta en 1000 sin avisar.
const ordenes = await traerTodo<{
  ot_number: number;
  descripcion: string | null;
  equipment_id: string | null;
  fecha_ejecucion: string | null;
}>((de, a) =>
  admin
    .from("ordenes_trabajo")
    .select("ot_number, descripcion, equipment_id, fecha_ejecucion")
    .eq("tipo", "PROGRAMADO")
    .gte("fecha_ejecucion", desde)
    .order("ot_number")
    .range(de, a)
);

const componentesDb = await traerTodo<{ nombre: string | null }>((de, a) =>
  admin.from("equipos_componentes").select("nombre").range(de, a)
);
const componentes = [...new Set(componentesDb.map((c) => c.nombre).filter((n): n is string => !!n))];

const equipos = await traerTodo<{ id: string; code: string | null; name: string | null }>((de, a) =>
  admin.from("equipos").select("id, code, name").range(de, a)
);
const nombreDe = new Map(equipos.map((e) => [e.id, e.code ?? e.id]));

const { tareas, cobertura } = catalogoPropuesto(ordenes, componentes);

console.log(`Órdenes PROGRAMADO desde el ${desde}: ${cobertura.ordenes}`);
console.log(`Componentes del catálogo: ${componentes.length} nombres distintos\n`);

const pct = (n: number) => `${((100 * n) / Math.max(1, cobertura.ordenes)).toFixed(0)} %`;
console.log(`  preventivas reconocidas .. ${String(cobertura.conAccionPreventiva).padStart(4)}  ${pct(cobertura.conAccionPreventiva)}`);
console.log(`     de ésas, con componente ${String(cobertura.enElCatalogo).padStart(4)}  ${pct(cobertura.enElCatalogo)}  ← el catálogo sale de acá`);
console.log(`  correctivas o de obra .... ${String(cobertura.conAccionCorrectiva).padStart(4)}  ${pct(cobertura.conAccionCorrectiva)}  cargadas como PROGRAMADO`);
console.log(`  sin acción reconocible ... ${String(cobertura.sinAccion).padStart(4)}  ${pct(cobertura.sinAccion)}`);

console.log(`\n${tareas.length} tareas distintas. Las que más órdenes dejarían de escribirse a mano:\n`);

const mostradas = TODAS ? tareas : tareas.slice(0, 30);
for (const t of mostradas) {
  const equiposConRitmo = t.equipos
    .map((e) => {
      const cada = e.intervaloTipico === null ? "sin ritmo" : `cada ~${e.intervaloTipico} d`;
      return `${nombreDe.get(e.equipmentId) ?? e.equipmentId} ${e.veces}× ${cada}`;
    })
    .slice(0, 4);
  const resto = t.equipos.length > 4 ? ` y ${t.equipos.length - 4} equipo(s) más` : "";
  console.log(`  ${String(t.veces).padStart(3)}×  ${comoSeLee(t.accion, t.componente)}`);
  console.log(`        ${equiposConRitmo.join(" · ")}${resto}`);
}
if (!TODAS && tareas.length > mostradas.length) {
  console.log(`\n  … y ${tareas.length - mostradas.length} tareas más. Con --todas salen todas.`);
}

// La curva, que es lo que dice si vale la pena: cuántas tareas hay que
// confirmar para cubrir la mitad y las tres cuartas partes del trabajo.
const total = tareas.reduce((a, t) => a + t.veces, 0);
let acumulado = 0;
console.log("");
for (const [i, t] of tareas.entries()) {
  const antes = acumulado;
  acumulado += t.veces;
  for (const p of [0.5, 0.75, 0.9]) {
    if (acumulado >= total * p && antes < total * p) {
      console.log(`  las ${String(i + 1).padStart(3)} primeras cubren el ${(100 * acumulado / total).toFixed(0)} % de las ${total} órdenes del catálogo`);
    }
  }
}

// ── LO QUE LE FALTA AL CATÁLOGO DE COMPONENTES ──────────────────────────────
//
// Es la salida más accionable de todo esto, y apareció corriéndolo: el
// catálogo nombra piezas de relevamiento y las órdenes nombran lo que se toca
// ese día. Cada palabra de acá es una preventiva que hoy no se puede agrupar.
const faltantes = candidatasAComponente(
  ordenes,
  componentes,
  equipos.map((e) => e.name ?? "")
);
if (faltantes.length > 0) {
  console.log(`
── Lo que las órdenes nombran y el catálogo de componentes no tiene ──`);
  console.log(`   Agregarlas a \`equipos_componentes\` es lo que sube la cobertura.
`);
  for (const c of faltantes.slice(0, 15)) {
    console.log(`  ${String(c.veces).padStart(4)} órdenes la nombran · ${c.palabra}`);
  }
  if (faltantes.length > 15) console.log(`  … y ${faltantes.length - 15} palabras más.`);
}

if (SUELTAS) {
  console.log(`\n── Las que no entraron, para mirar a mano ──`);
  const sueltas = ordenes.filter((o) => accionDe(o.descripcion) === null).slice(0, 40);
  for (const o of sueltas) console.log(`  OT ${o.ot_number}  ${String(o.descripcion ?? "").slice(0, 90)}`);
  console.log(`  (${cobertura.sinAccion} en total; se muestran hasta 40)`);
}
