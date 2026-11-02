// Lo que devuelven las rutas de Disponibilidad, contra la base real. SÓLO LEE.
//
// POR QUÉ EXISTE
//
// Las tres rutas piden sesión, así que no se pueden llamar por HTTP desde acá y
// lo que hay que comprobar —qué sale en el JSON— no depende de la sesión. Por
// eso las lecturas viven en `lib/rrhh/ausentismo/lecturas.ts`, separadas de las
// rutas, y este script las ejercita.
//
// LA COMPROBACIÓN QUE IMPORTA, Y POR QUÉ SE HACE SOBRE EL JSON
//
// `/api/disponibilidad` está abierta a cualquier autenticado y lee con el
// cliente admin una tabla que RLS tiene cerrada con `tiene_acceso_rrhh()`. O
// sea que RLS no corre y **el único permiso es el que escribió la ruta**. Lo que
// no puede salir es el MOTIVO: `ENFERMEDAD_ACCIDENTE_INCULPABLE`, `LICENCIA_ART`
// y `SUSPENSION` son dato médico y disciplinario, y son un tercio de la tabla.
//
// Se pregunta sobre el JSON serializado y no leyendo el código porque una
// proyección incompleta se lee bien y filtra igual. Los motivos que busca salen
// de la base y no de una lista escrita a mano, así que un valor nuevo del enum
// queda cubierto solo.
//
// Uso:
//   npx tsx scripts/probar-rutas-de-disponibilidad.mts
//   npx tsx scripts/probar-rutas-de-disponibilidad.mts --mes=2026-09
//
// Necesita las claves de Supabase en `.env.local`. No escribe nada.
import { readFileSync, existsSync } from "node:fs";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { leerDisponibilidad, leerReportes, leerEmpleados } = await import("../lib/rrhh/ausentismo/lecturas.ts");
const { reportesQueVe } = await import("../lib/rrhh/ausentismo/armarReportes.ts");

const args = process.argv.slice(2);
const valorDe = (nombre: string) => {
  const a = args.find((x) => x.startsWith(`--${nombre}=`));
  return a ? a.slice(nombre.length + 3) : undefined;
};
const mes = valorDe("mes") ?? new Date().toISOString().slice(0, 7);
if (!/^\d{4}-\d{2}$/.test(mes)) {
  console.error(`--mes tiene que ser AAAA-MM y llegó «${mes}».`);
  process.exit(1);
}

const db = createAdminClient();
const titulo = (t: string) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 70 - t.length))}`);

// Los motivos que hay HOY en la tabla, no una lista a mano: un valor nuevo del
// enum entra solo en la comprobación.
const { data: tipos } = await db.from("ausencias").select("tipo");
const MOTIVOS = [...new Set((tipos ?? []).map((t) => (t as { tipo: string }).tipo))];
const empleados = await leerEmpleados(db);
const NOMBRES = empleados.flatMap((e) => [e.nombre, e.apellido]).filter((n) => n && n.length > 2);

/** Qué cadenas prohibidas aparecen en un JSON. Vacío es lo que se quiere. */
function loQueSeEscapa(json: string, agujas: string[]): string[] {
  return [...new Set(agujas.filter((a) => json.includes(a)))];
}

titulo(`Base`);
console.log(`  ${empleados.length} empleados · ${tipos?.length ?? 0} ausencias · motivos distintos: ${MOTIVOS.length}`);
console.log(`  ${MOTIVOS.join(" · ")}`);

// ── /api/disponibilidad ─────────────────────────────────────
const [anio, mm] = mes.split("-").map(Number);
const ultimo = new Date(Date.UTC(anio, mm, 0)).getUTCDate();
const dias: string[] = [];
for (let d = 1; d <= ultimo; d++) dias.push(`${mes}-${String(d).padStart(2, "0")}`);

const disponibilidad = await leerDisponibilidad(db, dias);
const jsonDisp = JSON.stringify(disponibilidad);

titulo(`GET /api/disponibilidad — el mes ${mes} entero`);
console.log(`  ${disponibilidad.ausentes.length} ausentes en ${disponibilidad.dias.length} días`);
const clavesDisp = [...new Set(disponibilidad.ausentes.flatMap((a) => Object.keys(a)))].sort();
console.log(`  claves de cada ausente: ${clavesDisp.join(", ")}`);
const fugaMotivo = loQueSeEscapa(jsonDisp, [...MOTIVOS, "tipo", "observacion", "justificada", "motivo"]);
console.log(`  ¿se escapa el motivo?  ${fugaMotivo.length === 0 ? "NO" : `SÍ: ${fugaMotivo.join(", ")}`}`);
if (disponibilidad.ausentes[0]) console.log(`  ejemplo: ${JSON.stringify(disponibilidad.ausentes[0])}`);

// ── /api/disponibilidad/reportes ────────────────────────────
const todo = await leerReportes(db, mes);
const recortado = reportesQueVe(todo, false);
const jsonRecortado = JSON.stringify(recortado);

titulo(`GET /api/disponibilidad/reportes?mes=${mes} — lo que ve QUIEN NO pasa el control`);
console.log(`  claves: ${Object.keys(recortado).sort().join(", ")}`);
console.log(`  total del mes: ${recortado.mensual.total} días en ${recortado.mensual.filas.length} sectores`);
const fugaReporte = loQueSeEscapa(jsonRecortado, [...MOTIVOS, "porMotivo", "totalPorMotivo", ...NOMBRES]);
console.log(`  ¿se escapa un motivo o un nombre?  ${fugaReporte.length === 0 ? "NO" : `SÍ: ${fugaReporte.join(", ")}`}`);

titulo(`GET /api/disponibilidad/reportes?mes=${mes} — lo que ve quien SÍ pasa`);
console.log(`  claves: ${Object.keys(todo).sort().join(", ")}`);
console.log(`  mensual ${todo.mensual.total} días · anual ${todo.anual.filas.length} personas · porcentual general ${todo.porcentual.general.toFixed(1)} %`);
console.log(`  huérfanas: mensual ${todo.mensual.ausenciasHuerfanas} · anual ${todo.anual.ausenciasHuerfanas} · porcentual ${todo.porcentual.ausenciasHuerfanas}`);

titulo("Avisos");
// `avisos` es el único campo que pasa entero al lado abierto, así que también se
// mira acá: un aviso que nombre a alguien saldría sin que nada lo frene.
for (const a of todo.avisos) console.log(`  · ${a}`);
const fugaAviso = loQueSeEscapa(JSON.stringify(todo.avisos), [...MOTIVOS, ...NOMBRES]);
console.log(`  ¿algún aviso nombra a alguien o un motivo?  ${fugaAviso.length === 0 ? "NO" : `SÍ: ${fugaAviso.join(", ")}`}`);

// ── R27: los inactivos ──────────────────────────────────────
const { data: activos } = await db.from("empleados").select("id").eq("activo", true);
titulo("R27 — los inactivos con ausencias tienen que entrar igual");
console.log(`  empleados leídos: ${empleados.length} · activos: ${activos?.length ?? 0}`);
console.log(`  se leen todos: ${empleados.length > (activos?.length ?? 0) ? "SÍ, los inactivos entran" : "no hay inactivos hoy"}`);
console.log(`  huérfanas en el mensual: ${todo.mensual.ausenciasHuerfanas} (0 es la prueba de que no se perdió ninguna)`);

const seEscapaAlgo = fugaMotivo.length > 0 || fugaReporte.length > 0 || fugaAviso.length > 0;
console.log(`\n${seEscapaAlgo ? "ROMPE: algo que no puede salir está saliendo." : "Nada que no pueda verse salió en ningún JSON."}`);
console.log("No se escribió nada.");
if (seEscapaAlgo) process.exitCode = 1;
