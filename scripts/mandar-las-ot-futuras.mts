// Manda al calendario las OT que ya existían con fecha de hoy en adelante.
//
// POR QUÉ EXISTE
//
// Todo lo que se construyó manda una OT a Google Calendar cuando se crea o
// cuando llega de la planilla. Las órdenes que ya estaban —21 abiertas con
// fecha de hoy en adelante, medido el 04/11/2026— no tienen evento y nada se
// los va a dar: el barrido de después de cada sincronización las recogería de a
// 25 por corrida, pero sin que nadie lo decida ni lo vea. Esto lo hace una vez,
// a propósito y mirando antes qué va a pasar.
//
// POR QUÉ CORRE EN SECO SI NO SE LE PIDE OTRA COSA
//
// Es lo más caro de correr de todo el plan: cada evento invita a cinco
// casillas, así que 21 órdenes son unas cien invitaciones que llegan juntas a
// buzones de verdad, y **una invitación mandada no se deshace**. Por eso el
// orden es el de la prudencia: sin argumento **no escribe nada** —ni la base ni
// Google— y dice qué mandaría, a qué hora y a cuántos; sólo `--mandar` lo hace.
//
//   npx tsx scripts/mandar-las-ot-futuras.mts            # en seco
//   npx tsx scripts/mandar-las-ot-futuras.mts --mandar   # de verdad
//
// LA SELECCIÓN NO ESTÁ COPIADA
//
// Qué órdenes califican lo decide `ordenesQueFaltan`, la misma función que
// recorre `barrerLasQueFaltan`; y cuántos eventos hay ya ese día en cada grupo
// lo cuenta `huecosOcupados`, la misma que usa `mandarLaOTAlCalendario`. Lo
// único que la corrida en seco hace por su cuenta es **llevar la cuenta de las
// órdenes que ella misma va colocando** (`proyectarElBarrido`), porque sin
// escribir nada la base no las tiene todavía. Con una sola definición de
// «cuáles», lo que se ve acá es lo que después se manda.
//
// LO QUE LA CORRIDA EN SECO NO PUEDE SABER
//
// Que todas salgan bien: si una falla en la de verdad, las siguientes de su
// grupo suben un lugar. Y que entre una y otra pase algo en la planilla: el
// barrido de las sincronizaciones puede mandar algunas por su cuenta (la
// segunda corrida las encuentra ya con evento y no las repite). Conviene correr
// la de verdad poco después de mirar la de seco.
//
// UNA SOLA PASADA
//
// El tope por corrida (`TOPE_POR_CORRIDA`) cuenta eventos creados, igual que en
// el barrido. Si hubiera más que eso, el resto queda para otra corrida —de este
// script o de la sincronización— y el informe lo dice.
//
// Necesita NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en `.env.local`,
// y GOOGLE_SERVICE_ACCOUNT_JSON sólo con `--mandar`.

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { barrerLasQueFaltan, ordenesQueFaltan, TOPE_POR_CORRIDA } from "../lib/agenda/barridoDeNuevas.ts";
import { huecosOcupados, TURNO_AUTOMATICO } from "../lib/agenda/mandarLaOT.ts";
import { proyectarElBarrido } from "../lib/agenda/proyeccionDelBarrido.ts";
import { claveDelHueco } from "../lib/agenda/apilado.ts";
import { elegirElDuenoDeLaOT } from "../lib/agenda/duenoDeLaOT.ts";
import { invitacionesDeLaOT } from "../lib/agenda/evento.ts";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const argumentos = process.argv.slice(2);
const desconocidos = argumentos.filter((a) => a !== "--mandar");
if (desconocidos.length > 0) {
  console.error(`Argumento desconocido: ${desconocidos.join(" ")}. El único que existe es --mandar; sin él corre en seco.`);
  process.exit(1);
}
const mandar = argumentos.includes("--mandar");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !clave) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.");
  process.exit(1);
}
if (mandar && !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  console.error("Falta GOOGLE_SERVICE_ACCOUNT_JSON en .env.local: sin eso no se puede escribir en Google.");
  process.exit(1);
}

const db = createClient(url, clave);
const ahora = new Date();

// ── La selección: la misma para las dos corridas ───────────────────────────
const seleccion = await ordenesQueFaltan(db, ahora);
if (seleccion.error) {
  console.error(seleccion.error);
  process.exit(1);
}
const { faltan, fechasIlegibles } = seleccion;

console.log(mandar ? "CORRIDA DE VERDAD (--mandar)" : "CORRIDA EN SECO: no se escribe nada ni se invita a nadie");
console.log(
  `Órdenes abiertas con fecha de hoy en adelante y sin evento: ${faltan.length}` +
    ` · tope de esta pasada: ${TOPE_POR_CORRIDA} eventos creados\n`
);
if (fechasIlegibles.length > 0) {
  console.log("Con la fecha ilegible (no entrarían):");
  for (const f of fechasIlegibles) console.log(`  ${f}`);
  console.log("");
}

if (!mandar) {
  // ── EN SECO: sólo lecturas ───────────────────────────────────────────────
  // Cuántos eventos tiene ya cada grupo de esos días, preguntado a la misma
  // función que va a preguntar la corrida de verdad.
  const enLaBase = new Map<string, number>();
  for (const { orden, fecha } of faltan) {
    const k = claveDelHueco(fecha, orden.especialidad, TURNO_AUTOMATICO);
    if (enLaBase.has(k)) continue;
    // `exceptoLaOrden` vacío: ninguna de estas tiene evento, no hay propio que descontar.
    enLaBase.set(k, await huecosOcupados(db, fecha, orden.especialidad, TURNO_AUTOMATICO, ""));
  }

  const { van, quedan, sinHorario } = proyectarElBarrido(
    faltan, TURNO_AUTOMATICO, (k) => enLaBase.get(k) ?? 0, TOPE_POR_CORRIDA
  );

  // ¿Hay un usuario activo en la casilla del área? Sin él, las órdenes que nadie
  // cargó en el sistema fallan con un 409 en la corrida de verdad.
  const delAreaActivo = new Map<string, boolean>();
  const hora = (iso: string) => iso.slice(11, 16);
  let invitaciones = 0;
  let enviables = 0;
  const avisos: string[] = [];

  console.log("OT      Fecha       Hora   Especialidad       Dueño del evento                       Invita a");
  for (const p of van) {
    const dueno = await elegirElDuenoDeLaOT(db, p.orden.created_by);
    const numero = String(p.orden.ot_number ?? "s/n").padEnd(7);
    const esp = (p.orden.especialidad ?? "(sin especialidad)").padEnd(18);
    if (!dueno.ok) {
      console.log(`${numero} ${p.fecha}  ${hora(p.inicio)}  ${esp} NO SE PUEDE: ${dueno.error}`);
      avisos.push(`OT ${p.orden.ot_number}: ${dueno.error}`);
      continue;
    }
    if (dueno.id === null && !delAreaActivo.has(dueno.casilla)) {
      const { data, error } = await db
        .from("usuarios").select("id").ilike("email", dueno.casilla).eq("activo", true).maybeSingle();
      delAreaActivo.set(dueno.casilla, !error && Boolean(data));
    }
    const sinUsuario = dueno.id === null && !delAreaActivo.get(dueno.casilla);
    const { reciben } = invitacionesDeLaOT(dueno.casilla, []);
    const nota = [p.topeado ? "TOPEADA" : "", sinUsuario ? "FALLARÍA: no hay usuario activo en esa casilla" : ""]
      .filter(Boolean).join(" · ");
    console.log(
      `${numero} ${p.fecha}  ${hora(p.inicio)}  ${esp} ${dueno.casilla.padEnd(38)} ${sinUsuario ? "-" : reciben.length}` +
        (nota ? `   ${nota}` : "")
    );
    if (sinUsuario) {
      avisos.push(`OT ${p.orden.ot_number}: la casilla ${dueno.casilla} no tiene un usuario activo en el SdG, así que no se crearía su evento.`);
    } else {
      enviables++;
      invitaciones += reciben.length;
    }
  }

  console.log("");
  console.log(`Se mandarían: ${enviables} órdenes, ${invitaciones} invitaciones.`);
  if (quedan > 0) {
    console.log(`Quedarían ${quedan} para otra pasada: el tope es ${TOPE_POR_CORRIDA} eventos creados por corrida.`);
  }
  for (const o of sinHorario) {
    avisos.push(`OT ${o.ot_number ?? o.id}: no se pudo calcular su horario, fallaría.`);
  }
  if (avisos.length > 0) {
    console.log("\nA mirar antes de mandar:");
    for (const a of avisos) console.log(`  - ${a}`);
  }
  console.log("\nNo se escribió nada. Para mandarlas de verdad: npx tsx scripts/mandar-las-ot-futuras.mts --mandar");
  process.exit(0);
}

// ── DE VERDAD: lo único que escribe ──────────────────────────────────────────
// Recorre exactamente lo que la corrida en seco mostró, porque es la misma
// función que el barrido de las sincronizaciones.
//
// **Dice qué mandó en el momento y no sólo cuántas**: una invitación no se
// deshace, y si la corrida se corta a la mitad (el presupuesto de Google, una
// caída) quien la corre tiene que poder leer en la pantalla cuáles salieron,
// sin ponerse a consultar la base después. Por eso cada orden se imprime apenas
// se intenta, y al final se junta todo de nuevo.
const salieron: (number | string)[] = [];
const pendientesEnGoogle: (number | string)[] = [];
const noSalieron: { numero: number | string; error: string }[] = [];
const numeroDe = (o: { ot_number: number | null; id: string }) => o.ot_number ?? o.id;

const r = await barrerLasQueFaltan(db, ahora, TOPE_POR_CORRIDA, undefined, (d) => {
  if (d.ok) {
    salieron.push(d.numero);
    if (d.enGoogle === false) pendientesEnGoogle.push(d.numero);
    console.log(`  OT ${d.numero}: creada${d.enGoogle === false ? " en el SdG, pero NO llegó a Google todavía" : ""}`);
  } else {
    noSalieron.push({ numero: d.numero, error: d.error ?? "sin motivo" });
    console.log(`  OT ${d.numero}: FALLÓ: ${d.error}`);
  }
});

// Las que no se intentaron: lo que la selección de arriba tenía y el barrido no
// llegó a tocar (tope o tiempo). Se saca de la lista de antes de empezar y no de
// una nueva lectura, que ya las vería distinto.
const intentadas = new Set<number | string>([...salieron, ...noSalieron.map((f) => f.numero)]);
const sinIntentar = faltan.map((f) => numeroDe(f.orden)).filter((n) => !intentadas.has(n));

console.log("");
console.log(`Eventos creados: ${r.creados}`);
// Cada OT bajo un solo título: «creadas» sin las que no llegaron a Google, que
// tienen su línea aparte. Quien leyera sólo la primera daría por mandadas las que no.
const creadasYEnviadas = salieron.filter((n) => !pendientesEnGoogle.includes(n));
if (creadasYEnviadas.length > 0) {
  console.log(`  Quedaron creadas y en Google: ${creadasYEnviadas.map((n) => `OT ${n}`).join(", ")}`);
}
if (pendientesEnGoogle.length > 0) {
  console.log(`  Creadas en el SdG pero todavía sin llegar a Google (se reintentan solas): ${pendientesEnGoogle.map((n) => `OT ${n}`).join(", ")}`);
}
if (noSalieron.length > 0) {
  console.log("Fallaron:");
  for (const f of noSalieron) console.log(`  OT ${f.numero}: ${f.error}`);
}
if (r.fallos.length > noSalieron.length) {
  // Un fallo que no es de una orden en particular (por ejemplo, no poder leer la base).
  console.log("Otros fallos:");
  for (const f of r.fallos.filter((x) => !noSalieron.some((n) => x.startsWith(`OT ${n.numero}:`)))) console.log(`  ${f}`);
}
if (sinIntentar.length > 0) {
  console.log(
    `Sin intentar (${sinIntentar.length}, tope por corrida o tiempo): ${sinIntentar.map((n) => `OT ${n}`).join(", ")}.` +
      ` Volvé a correr el script o esperá a la sincronización.`
  );
}
process.exit(r.fallos.length > 0 ? 1 : 0);
