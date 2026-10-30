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
const { clasificar, porQueNoSeReconoce, ausenciasQueSeTocan, esJustificada, emparejarEmpleado } = await import("../lib/rrhh/importarNovedades.ts");
const { tipoDesdeElMotivo } = await import("../lib/rrhh/importarNovedades.ts");
const { labelTipoAusencia } = await import("../lib/rrhh/tiposAusencia.ts");
type NovedadDePlanilla = import("../lib/rrhh/importarNovedades.ts").NovedadDePlanilla;

const PLANILLA_ID = "164obdrj7BmEsWofK-0NOi-i_Ue7Ca5hW5nwBuuv88N0";
const PESTANA = "NOVEDADES";

const args = process.argv.slice(2);
const escribir = args.includes("--escribir");
// Todo lo que sigue al primer «=» es el valor: un id o una fecha no llevan otro, pero cortar en el
// segundo callaría un valor mal escrito en vez de rechazarlo.
const valorDe = (nombre: string) => {
  const a = args.find((x) => x.startsWith(`--${nombre}=`));
  return a ? a.slice(nombre.length + 3) : undefined;
};
const desdeCorte = valorDe("desde") ?? "2026-01-01";
if (!/^\d{4}-\d{2}-\d{2}$/.test(desdeCorte) || isNaN(Date.parse(`${desdeCorte}T00:00:00Z`))) {
  console.error(`--desde tiene que ser una fecha AAAA-MM-DD y llegó «${desdeCorte}».`);
  process.exit(1);
}
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
    // Una clave vacía o nula no es una persona: no puede ganar la cuenta.
    for (const a of existentes) {
      if (!a.cargado_por_id) continue;
      cuenta.set(a.cargado_por_id, (cuenta.get(a.cargado_por_id) ?? 0) + 1);
    }
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

/** El tipo del enum de una novedad, para comparar contra el de lo que ya estaba. */
const tipoDeLaNovedad = (n: NovedadDePlanilla) => tipoDesdeElMotivo(n.motivo);

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
console.log(`  fuera del corte${String(fueraDelCorte.length).padStart(4)}   (aparte: no pasaron por la clasificación)`);

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

const rango = (n: { desde: string; hasta: string }) => `${n.desde || "?"} → ${n.hasta || "?"}`;

titulo(`Se importan aunque se solapan con una ausencia de OTRO tipo`);
console.log("  Estas SE IMPORTAN. Se listan porque ahí es donde se escondería un duplicado de verdad:");
console.log("  si la ausencia que ya está es la misma que la de la planilla con otro motivo, hay que sacarla antes de --escribir.");
const seSolapanConOtroTipo = aImportar
  .map((n) => ({ n, choques: ausenciasQueSeTocan(n, n.empleadoId, existentes).filter((a) => a.tipo !== n.tipo) }))
  .filter((x) => x.choques.length > 0);
console.log(`  (${seSolapanConOtroTipo.length})`);
for (const { n, choques } of seSolapanConOtroTipo) {
  console.log(`  fila ${String(n.fila).padStart(3)}  ${n.nombre}  ${rango(n)}  ${n.motivo}   <- planilla, SE IMPORTA`);
  for (const a of choques) {
    console.log(`           ya está: ${a.fecha_desde} → ${a.fecha_hasta}  ${labelTipoAusencia(a.tipo)}`);
  }
}

titulo(`Ya estaban (${yaEstaban.length}): descartadas por solaparse con una del MISMO tipo`);
for (const n of yaEstaban) {
  const empleadoId = emparejarEmpleado(n.nombre, empleados)!;
  const choques = ausenciasQueSeTocan(n, empleadoId, existentes);
  console.log(`  fila ${String(n.fila).padStart(3)}  ${n.nombre}  ${rango(n)}  ${n.motivo}`);
  if (!choques.length) {
    console.log("           choca con: otra novedad idéntica de la misma planilla (entra una sola vez)");
  }
  for (const a of choques) {
    const marca = a.tipo !== tipoDeLaNovedad(n) ? "   (otro tipo; no es lo que la descartó)" : "";
    console.log(`           choca con: ${a.fecha_desde} → ${a.fecha_hasta}  ${labelTipoAusencia(a.tipo)}${marca}`);
  }
}

titulo(`Fuera del corte (${fueraDelCorte.length}): terminaron antes del ${desdeCorte}`);
console.log("  Se sacan antes de clasificar. El sistema no tiene datos de 2025 y los reportes son por año:");
console.log("  una ausencia que termina antes del corte no cambia ningún número de 2026. --desde=AAAA-MM-DD mueve la línea.");
for (const n of fueraDelCorte) {
  console.log(`  fila ${String(n.fila).padStart(3)}  ${n.nombre}  ${rango(n)}  ${n.motivo}`);
}

titulo("Quién figura como cargado por");
console.log(quien ? `  ${quien.etiqueta}` : "  (no se pudo deducir: pasá --cargado-por=<id de usuario>)");

// Ningún `process.exit` desde acá: con stdout redirigido a un archivo (que es como se
// guarda la lista de revisión) no vacía lo que se imprimió. Se deja `exitCode` y se termina.
if (!escribir) {
  console.log("\nNo se escribió nada. Para importar: --escribir");
} else {
  await escribirEnLaBase();
}

async function escribirEnLaBase() {
  if (!quien) {
    console.error("\nNo se puede escribir sin saber quién figura como cargado por.");
    process.exitCode = 1;
    return;
  }

  const filas = aImportar.map((n) => {
    const obs = observacionDeFila.get(n.fila);
    return {
      empleado_id: n.empleadoId,
      fecha_desde: n.desde,
      fecha_hasta: n.hasta,
      tipo: n.tipo,
      // NOVEDADES no tiene columna «justificada»: la regla es de esta importación (ver
      // `esJustificada`) y no algo copiado de la app.
      justificada: esJustificada(n.tipo),
      // La marca de la fila es lo que permite deshacer: cada una es identificable y se
      // borra con un DELETE dirigido. No hay llamada a `auditar()` en este camino.
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
      process.exitCode = 1;
      return;
    }
    insertadas += lote.length;
  }
  console.log(`\nInsertadas ${insertadas} ausencias. No se recalculó calculos_diarios (a propósito).`);
}
