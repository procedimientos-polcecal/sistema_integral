// Convierte en ausencias los períodos de vacaciones que no nacieron de una.
// De una sola vez. EN SECO por defecto: escribe sólo con `--aplicar`.
//
// POR QUÉ EXISTE
//
// `/disponibilidad`, la programación del taller y los tres reportes de
// ausentismo leen `ausencias` y nada más. Hasta el 16/11/2026 la pantalla de
// RRHH → Vacaciones insertaba derecho en `vacaciones`, así que esos períodos no
// existían para ninguno de los tres. Medido ese día contra producción: de 41
// períodos, **20 eran así**, y 4 tocaban ese día o uno futuro — había gente de
// vacaciones que la pantalla mostraba como presente.
//
// La ruta ya está arreglada (todo período nuevo nace de una ausencia). Esto es
// para los 20 que quedaron atrás.
//
// LO QUE NO HACE, Y POR QUÉ
//
// **No toca `dias_tomados`.** Dos de los 20 tienen el número escrito a mano y
// distinto del calendario. Normalizarlos acá movería el balance de vacaciones
// de dos personas como efecto colateral de un relleno que nadie les pidió, así
// que se los lista y quedan como están. La primera vez que alguien edite uno de
// esos períodos desde la pantalla, pasa al calendario y ese balance se mueve un
// día: es la decisión que tomó el usuario el 16/11/2026, sabiendo esto.
//
// **No recalcula `calculos_diarios`.** Sería un no-op: `lib/rrhh/engine/
// recalcular.ts` lee la tabla `vacaciones` **directo** y la vacación le gana a
// la ausencia (`if (vacacion) ausente = false`), así que esos días ya llegaban
// bien y las filas salen idénticas antes y después. Un paso que no cambia nada
// pero que parece que sí es peor que no tenerlo: el próximo lector lo toma como
// prueba de que algo se movió.
//
// **No reusa `altaDeAusencia()`.** Esa función llama a
// `sincronizarPeriodoVacaciones()`, que busca el período por `ausencia_id` y,
// al no encontrarlo, insertaría un **segundo** período en vez de enganchar el
// que ya existe. Acá se inserta la ausencia y después se le pega el id al
// período que está.
//
// EL CORREO
//
// `/api/cron/rrhh-novedades` corre a las 18:50 UTC, corta el día por
// `created_at` y manda un correo a cada encargado —hoy doce— con las ausencias
// cargadas ese día. Las que crea esto nacen todas con el `created_at` del
// momento, así que **ese correo sale con las veinte de golpe**. Está acordado:
// se avisa antes y se deja salir, porque el correo es el rastro público de la
// carga.
//
// Diseño: docs/superpowers/specs/2026-11-16-vacaciones-en-disponibilidad-design.md
//
// Uso:
//   npx tsx scripts/vacaciones-huerfanas-a-ausencias.mts --usuario=<uuid>
//   npx tsx scripts/vacaciones-huerfanas-a-ausencias.mts --usuario=<uuid> --aplicar
//
// Necesita las claves de Supabase en `.env.local`.
import { readFileSync, existsSync } from "node:fs";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { diasEntre } = await import("../lib/rrhh/vacacionesDeAusencia.ts");

const APLICAR = process.argv.includes("--aplicar");
const USUARIO = process.argv.find((a) => a.startsWith("--usuario="))?.slice("--usuario=".length);

/**
 * La línea que explica de dónde salió la ausencia.
 *
 * `cargado_por_id` es not null y no hay forma de saber quién cargó esos
 * períodos: va el usuario que corre esto. Sin esta línea, su nombre se leería
 * como una afirmación sobre quién los cargó, que sería falsa.
 */
const DE_DONDE_SALIO =
  "Vacaciones cargadas desde Balance por empleado. La ausencia se creó el 16/11/2026 al unificar las dos puertas de carga.";

function dia(v: unknown): string {
  return String(v ?? "").slice(0, 10);
}

if (!USUARIO) {
  console.error("Falta --usuario=<uuid>: es el `cargado_por_id` de las ausencias que se creen.");
  process.exit(1);
}

const db = createAdminClient();

const { data: quien } = await db
  .from("usuarios")
  .select("id, nombre, apellido")
  .eq("id", USUARIO)
  .maybeSingle();
if (!quien) {
  console.error(`No hay ningún usuario con id ${USUARIO}.`);
  process.exit(1);
}

const { data: periodos, error } = await db
  .from("vacaciones")
  .select("id, empleado_id, ausencia_id, anio_correspondiente, fecha_desde, fecha_hasta, dias_tomados, observaciones")
  .is("ausencia_id", null)
  .order("fecha_desde");
if (error) {
  console.error("No se pudieron leer los períodos:", error.message);
  process.exit(1);
}

const huerfanos = periodos ?? [];
console.log(`${APLICAR ? "APLICANDO" : "EN SECO"} — ${huerfanos.length} períodos sin ausencia.`);
console.log(`cargado_por_id: ${quien.apellido}, ${quien.nombre} (${quien.id})\n`);

// Todas las ausencias, para el control de solapamiento. Son pocas y así no se
// arma un `.in()` con muchos ids, que PostgREST rechaza con un 400 mudo.
const { data: ausencias } = await db
  .from("ausencias")
  .select("id, empleado_id, tipo, fecha_desde, fecha_hasta");

let convertidos = 0;
const salteados: string[] = [];
const divergentes: string[] = [];

for (const p of huerfanos) {
  const desde = dia(p.fecha_desde);
  const hasta = dia(p.fecha_hasta);
  const calendario = diasEntre(desde, hasta);
  if (p.dias_tomados !== calendario) {
    divergentes.push(`  ${desde} → ${hasta}: dias_tomados=${p.dias_tomados}, calendario=${calendario}`);
  }

  // Se vuelve a comprobar acá y no sólo al diseñarlo: el día que se midió eran
  // 0 de 20, pero esto corre después y alguien pudo cargar una a mano.
  const pisa = (ausencias ?? []).filter(
    (a) => a.empleado_id === p.empleado_id && dia(a.fecha_desde) <= hasta && dia(a.fecha_hasta) >= desde
  );
  if (pisa.length > 0) {
    salteados.push(
      `  ${desde} → ${hasta} pisa ${pisa.map((a) => `${a.tipo} ${dia(a.fecha_desde)}→${dia(a.fecha_hasta)}`).join(", ")}`
    );
    continue;
  }

  const observaciones = [p.observaciones?.trim(), DE_DONDE_SALIO].filter(Boolean).join("\n");

  if (!APLICAR) {
    console.log(`  crearía ausencia VACACIONES ${desde} → ${hasta} (período ${p.id})`);
    convertidos++;
    continue;
  }

  const { data: ausencia, error: errorAlta } = await db
    .from("ausencias")
    .insert({
      empleado_id: p.empleado_id,
      fecha_desde: desde,
      fecha_hasta: hasta,
      tipo: "VACACIONES",
      justificada: true,
      observaciones,
      cargado_por_id: USUARIO,
    })
    .select("id")
    .single();
  if (errorAlta) {
    salteados.push(`  ${desde} → ${hasta}: no se pudo crear la ausencia: ${errorAlta.message}`);
    continue;
  }

  const { error: errorEnlace } = await db
    .from("vacaciones")
    .update({ ausencia_id: ausencia.id })
    .eq("id", p.id);
  if (errorEnlace) {
    // La ausencia quedó creada y el período sin enlazar: se borra la ausencia
    // para no dejar el día contado dos veces, una por cada tabla.
    await db.from("ausencias").delete().eq("id", ausencia.id);
    salteados.push(`  ${desde} → ${hasta}: no se pudo enlazar, se deshizo la ausencia: ${errorEnlace.message}`);
    continue;
  }

  console.log(`  ${desde} → ${hasta}: ausencia ${ausencia.id}`);
  convertidos++;
}

console.log(`\n${APLICAR ? "Convertidos" : "Se convertirían"}: ${convertidos} de ${huerfanos.length}`);

if (salteados.length > 0) {
  console.log(`\nSalteados (${salteados.length}):`);
  for (const s of salteados) console.log(s);
}

// Los que YA tenían ausencia también se miran: el 16/11/2026 había uno, y es
// la prueba de que un número tipeado al lado de uno calculado diverge solo
// —ése nació de una ausencia y aun así quedó a mano, o sea que alguien lo editó
// por el PUT y la sincronización no volvió a pasar—. Nombrarlos es el punto.
const { data: conAusencia } = await db
  .from("vacaciones")
  .select("fecha_desde, fecha_hasta, dias_tomados")
  .not("ausencia_id", "is", null)
  .order("fecha_desde");
for (const p of conAusencia ?? []) {
  const desde = dia(p.fecha_desde);
  const hasta = dia(p.fecha_hasta);
  const calendario = diasEntre(desde, hasta);
  if (p.dias_tomados !== calendario) {
    divergentes.push(
      `  ${desde} → ${hasta}: dias_tomados=${p.dias_tomados}, calendario=${calendario} (ya tenía ausencia)`
    );
  }
}

if (divergentes.length > 0) {
  console.log(`\ndias_tomados que no coincide con el calendario (${divergentes.length}):`);
  for (const d of divergentes) console.log(d);
  console.log(
    "  NO se tocan, por decisión del usuario. La primera vez que alguien edite\n" +
      "  uno de estos períodos desde la pantalla, pasa al calendario y el balance\n" +
      "  de esa persona se mueve un día."
  );
}

if (!APLICAR) console.log("\nNada se escribió. Para escribir: --aplicar");
