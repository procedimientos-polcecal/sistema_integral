// La pestaña NOVEDADES al sistema, UNA SOLA VEZ.
//
// POR QUÉ EXISTE
//
// NOVEDADES es la tabla `ausencias` llevada a mano en una planilla, y las dos
// listas divergieron en las dos direcciones. El SdG pasa a ser el único lugar
// donde se carga una ausencia; lo que sólo está en la planilla entra acá, una
// vez, y después la planilla no se vuelve a leer. Spec:
// docs/superpowers/specs/2026-10-29-disponibilidad-y-ausentismo-design.md
//
// QUÉ HACE Y QUÉ NO
//
// - **Sin `--escribir` no escribe nada.** Lee la planilla y la base, clasifica,
//   e imprime el resumen. Es el modo en que se corre primero y el que sirve para
//   que una persona revise la lista de lo que no se reconoció.
// - **Con `--escribir` inserta en `ausencias`, y sólo eso.** No llama a
//   `recalcularEmpleadoPeriodo()`: importar enero a junio reescribiría medio año
//   de `calculos_diarios`, que hoy está 77% marcado como ausente sin motivo (no
//   hay fichadas antes de julio y el motor asume que sin fichada no se vino).
//   Es seguro porque los tres reportes leen `ausencias`, no la tabla diaria. El
//   razonamiento completo está en `lib/rrhh/importarNovedades.ts`.
// - **Nunca escribe en la planilla.** Es la de producción: se lee y nada más.
// - Es **idempotente**: una vez importada, una novedad se solapa con lo que ella
//   misma insertó y la segunda corrida la cuenta como «ya estaba».
//
// Uso:
//   npx tsx scripts/importar-novedades.mts                    en seco
//   npx tsx scripts/importar-novedades.mts --escribir         inserta
//   --desde=2026-01-01   ignora lo que terminó antes (por defecto, el 1/1/2026)
//   --cargado-por=<id>   usuario que figura como quien las cargó
//
// Necesita `GOOGLE_SERVICE_ACCOUNT_JSON` y las claves de Supabase en `.env.local`.
import { readFileSync, existsSync } from "node:fs";
import type { Ausencia } from "../lib/rrhh/ausentismo/diasDeAusencia.ts";

// El env se carga ANTES de importar los módulos de Google: `lib/core/google.ts`
// lee la credencial al evaluarse, y con un `import` de arriba se evalúa sin ella.
const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { leerValores } = await import("../lib/core/sheets.ts");
const { fechaDeSheets } = await import("../lib/core/fechaDeSheets.ts");
const { norm } = await import("../lib/core/texto.ts");
const { traerTodo } = await import("../lib/core/paginado.ts");
const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { clasificar, porQueNoSeReconoce } = await import("../lib/rrhh/importarNovedades.ts");
const { labelTipoAusencia } = await import("../lib/rrhh/tiposAusencia.ts");
type NovedadDePlanilla = import("../lib/rrhh/importarNovedades.ts").NovedadDePlanilla;

const PLANILLA_ID = "164obdrj7BmEsWofK-0NOi-i_Ue7Ca5hW5nwBuuv88N0";
const PESTANA = "NOVEDADES";

const args = process.argv.slice(2);
const escribir = args.includes("--escribir");
const valorDe = (nombre: string) => args.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1];
const desdeCorte = valorDe("desde") ?? "2026-01-01";
const cargadoPorElegido = valorDe("cargado-por");

const db = createAdminClient();

// ── La planilla ─────────────────────────────────────────────
// Sin formato: las fechas llegan como serial, que `fechaDeSheets` lee sin tener
// que adivinar d/m o m/d.
const valores = await leerValores(PLANILLA_ID, PESTANA, { sinFormato: true });
const encabezados = (valores[0] ?? []).map((c) => norm(c));

/** La columna por su encabezado, y si falta se corta: escribir por posición ya costó caro. */
function columna(nombre: string): number {
  const i = encabezados.indexOf(norm(nombre));
  if (i === -1) {
    console.error(`No encuentro la columna «${nombre}» en ${PESTANA}. Encabezados: ${encabezados.join(" | ")}`);
    process.exit(1);
  }
  return i;
}
const cNombre = columna("NOMBRE Y APELLIDO");
const cDesde = columna("DESDE");
const cHasta = columna("HASTA");
const cMotivo = columna("MOTIVO");
const cObs = columna("OBSERVACIONES");

const novedades: NovedadDePlanilla[] = [];
const observacionDeFila = new Map<number, string>();
let filasEnBlanco = 0;

valores.slice(1).forEach((f, i) => {
  const fila = i + 2; // la 1 es el encabezado
  const nombre = String(f[cNombre] ?? "").trim();
  if (!nombre) { filasEnBlanco++; return; }
  novedades.push({
    fila,
    nombre,
    // Si no se lee la fecha, va vacía y `clasificar` la manda a revisar.
    desde: fechaDeSheets(f[cDesde]) ?? "",
    hasta: fechaDeSheets(f[cHasta]) ?? "",
    motivo: String(f[cMotivo] ?? "").trim(),
  });
  // En la columna OBSERVACIONES hay también años sueltos («2025»): eso no es una
  // observación, es el año del saldo de vacaciones. Sólo se conserva texto de verdad.
  const obs = String(f[cObs] ?? "").trim();
  if (obs && !/^\d+([.,]\d+)?$/.test(obs)) observacionDeFila.set(fila, obs);
});

// Lo que terminó antes del corte no se mira: el spec habla de las novedades de
// 2026 (más las de fines de 2025 que terminan dentro de enero).
const fueraDelCorte = novedades.filter((n) => n.hasta && n.hasta < desdeCorte);
const enAlcance = novedades.filter((n) => !(n.hasta && n.hasta < desdeCorte));

// ── La base ─────────────────────────────────────────────────
const empleados = await traerTodo<{ id: string; nombre: string; apellido: string }>((d, h) =>
  db.from("empleados").select("id, nombre, apellido").range(d, h)
);
const existentes = await traerTodo<Ausencia & { cargado_por_id: string }>((d, h) =>
  db.from("ausencias").select("empleado_id, fecha_desde, fecha_hasta, tipo, cargado_por_id").range(d, h)
);

const { aImportar, yaEstaban, sinReconocer } = clasificar(enAlcance, empleados, existentes);

// ── Quién figura como quien las cargó ───────────────────────
// La persona de RRHH que cargó las que ya están: es quien las habría cargado en
// el sistema si NOVEDADES no hubiera existido. Se deduce de los datos y se
// imprime; `--cargado-por` lo pisa.
async function quienCarga(): Promise<{ id: string; etiqueta: string } | null> {
  let id = cargadoPorElegido;
  if (!id) {
    const cuenta = new Map<string, number>();
    for (const a of existentes) cuenta.set(a.cargado_por_id, (cuenta.get(a.cargado_por_id) ?? 0) + 1);
    const ordenado = [...cuenta.entries()].sort((a, b) => b[1] - a[1]);
    if (!ordenado.length) return null;
    // Empate arriba: no se elige, se pide.
    if (ordenado.length > 1 && ordenado[0][1] === ordenado[1][1]) return null;
    id = ordenado[0][0];
  }
  const { data } = await db.from("usuarios").select("nombre, apellido, email").eq("id", id).maybeSingle();
  if (!data) return null;
  return { id, etiqueta: `${data.nombre} ${data.apellido} <${data.email}>` };
}
const quien = await quienCarga();

// ── El resumen ──────────────────────────────────────────────
const titulo = (t: string) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 70 - t.length))}`);

console.log(escribir ? "MODO ESCRITURA (--escribir)" : "EN SECO: no se escribe nada.");
console.log(`Planilla ${PESTANA}: ${valores.length - 1} filas leídas, ${filasEnBlanco} sin nombre, ${novedades.length} novedades.`);
console.log(`Base: ${empleados.length} empleados, ${existentes.length} ausencias.`);
console.log(`Corte: se ignoran las que terminaron antes del ${desdeCorte}: ${fueraDelCorte.length}.`);

titulo("Resultado");
console.log(`  a importar     ${String(aImportar.length).padStart(4)}`);
console.log(`  ya estaban     ${String(yaEstaban.length).padStart(4)}`);
console.log(`  sin reconocer  ${String(sinReconocer.length).padStart(4)}`);
console.log(`  fuera del corte${String(fueraDelCorte.length).padStart(4)}`);

titulo("A importar, por mes de inicio");
const porMes = new Map<string, number>();
for (const n of aImportar) porMes.set(n.desde.slice(0, 7), (porMes.get(n.desde.slice(0, 7)) ?? 0) + 1);
for (const [mes, c] of [...porMes].sort()) console.log(`  ${mes}  ${c}`);

titulo("A importar, por tipo");
const porTipo = new Map<string, number>();
for (const n of aImportar) porTipo.set(n.tipo, (porTipo.get(n.tipo) ?? 0) + 1);
for (const [t, c] of [...porTipo].sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(4)}  ${labelTipoAusencia(t)}`);

titulo(`Sin reconocer (${sinReconocer.length}): las resuelve una persona`);
const normApellido = (e: { apellido: string }) => norm(e.apellido);
for (const n of sinReconocer) {
  console.log(
    `  fila ${String(n.fila).padStart(3)}  ${n.nombre}  ${n.desde || "?"} → ${n.hasta || "?"}  ${n.motivo}` +
      `\n           porque: ${porQueNoSeReconoce(n, empleados)}`
  );
  // Una pista para quien revisa, NUNCA un enlace: los empleados cuyo apellido
  // abre ese nombre. Enlazar al que se le parece es peor que dejar en null.
  const pista = empleados.filter((e) => normApellido(e) && norm(n.nombre).startsWith(normApellido(e)));
  if (pista.length && pista.length <= 6) {
    console.log(`           posibles: ${pista.map((e) => `${e.apellido} ${e.nombre}`).join(" · ")}`);
  }
}

titulo("Quién figura como cargado por");
console.log(quien ? `  ${quien.etiqueta}` : "  (no se pudo deducir: pasá --cargado-por=<id de usuario>)");

if (!escribir) {
  console.log("\nNo se escribió nada. Para importar: --escribir");
  process.exit(0);
}

// ── Escribir ────────────────────────────────────────────────
if (!quien) {
  console.error("\nNo se puede escribir sin saber quién figura como cargado por.");
  process.exit(1);
}

const filas = aImportar.map((n) => {
  const obs = observacionDeFila.get(n.fila);
  return {
    empleado_id: n.empleadoId,
    fecha_desde: n.desde,
    fecha_hasta: n.hasta,
    tipo: n.tipo,
    // Lo único injustificado por definición es «Ausencia injustificada»: el resto
    // se cargó como un motivo de la lista y por eso se justifica.
    justificada: n.tipo !== "INJUSTIFICADA",
    observaciones: `Importada de la planilla NOVEDADES (fila ${n.fila}).${obs ? ` ${obs}` : ""}`,
    cargado_por_id: quien.id,
  };
});

let insertadas = 0;
for (let i = 0; i < filas.length; i += 100) {
  const lote = filas.slice(i, i + 100);
  const { error } = await db.from("ausencias").insert(lote);
  if (error) {
    console.error(`\nFalló el lote que empieza en la ${i + 1}: ${error.message}`);
    console.error(`Ya estaban insertadas ${insertadas}. Volver a correr es seguro: las que entraron figuran como «ya estaban».`);
    process.exit(1);
  }
  insertadas += lote.length;
}
console.log(`\nInsertadas ${insertadas} ausencias. No se recalculó calculos_diarios (a propósito).`);
