import type { SupabaseClient } from "@supabase/supabase-js";
import type { Turno } from "@/lib/mantenimiento/programacion";
import { traerTodo } from "@/lib/core/paginado";
import { fechaParaElCalendario, horarioDeLaOT, instanteDe, laOTEstaCerrada, TURNOS_DEL_TALLER } from "./evento";
import { aHoraDePared, aInstanteISO, eventoParaGoogle, idDeGoogleDe } from "./pedido";
import { columnasDespuesDeEscribir, escribirEnGoogle, parDivergencia, parPendiente } from "./escribirEnGoogle";
import { anotarEnLaFila } from "./cargar";

/**
 * El evento de una OT sigue a la OT.
 *
 * Dos caminos **sin nadie en pantalla** —la sincronización de la planilla de OT
 * y el borrado de espejo— tocan el evento de Google de una orden. Ahí no hay
 * quien reciba «no llegó a Google», así que cada fallo va a la cola
 * (`google_pendiente`, por `parPendiente`, que es la única función que escribe
 * ese par) y lo que no se puede resolver solo queda dicho en `aviso`.
 *
 * LO QUE DECIDE ESTE ARCHIVO, Y POR QUÉ ES INCÓMODO
 *
 * 1. **Un evento que ya divergió NO se pisa.** Si alguien lo movió o lo borró
 *    en Google, la sincronización lo deja quieto aunque la planilla cambie la
 *    fecha de la OT, y vuelve a alertar. El evento puede quedarse en el día
 *    viejo, a propósito: es el anti-objetivo de «pisar en silencio» llevado
 *    hasta su consecuencia. Lo destraba el dueño desde la Agenda.
 * 2. **Si la planilla VACÍA la fecha de una OT que ya tiene evento, el evento
 *    queda y se avisa.** No es «la OT se borró» ni «cambió de fecha»: es un
 *    dato que desapareció, y borrar el evento por eso sería adivinar. Para eso
 *    existe `aviso`: algo que una persona tiene que mirar y que no es ni un
 *    fallo de escritura ni una divergencia.
 * 3. **Una OT cerrada no se toca**: su evento pasado queda como registro de lo
 *    que se planificó.
 * 4. **Si la fecha de la OT cambia, el evento vuelve al horario de su turno,
 *    descartando una hora que alguien hubiera aceptado de Google.** La fecha de
 *    la OT es la autoridad de un evento de OT, y la hora aceptada pertenecía a
 *    la fecha vieja: conservarla sería inventar un horario para un día que
 *    nadie eligió. Si la fecha no cambió, la hora aceptada se respeta (no se
 *    compara la hora, sólo el día).
 * 5. **`escrito` guarda lo que Google devolvió, nunca lo que se mandó**
 *    (`columnasDespuesDeEscribir`): es lo único que distingue el eco de una
 *    escritura propia de un cambio hecho por una persona.
 */

/**
 * Cómo empieza el `aviso` de un borrado que Google rechazó. **Lo escribe
 * `borrarLosEventosDeLasOT` y `planDelEvento` no lo toca**: la sincronización
 * corre `seguirALasOT` justo después del borrado, y sin esta marca limpiaría ese
 * aviso en la misma corrida que lo escribió (la orden sigue en la base y su
 * fecha no cambió, así que «el aviso ya no corresponde» parecería cierto).
 */
export const AVISO_DE_BORRADO = "No se pudo borrar en Google el evento de una orden que ya no está en la planilla";

export type QueHacer =
  | { accion: "mover"; inicio: string; fin: string }
  | { accion: "no tocar"; motivo: string }
  | { accion: "avisar"; motivo: string };

/** La fecha (AAAA-MM-DD, hora de Argentina) en la que cae un evento, o `null` si su inicio no se lee. */
export function fechaDelEvento(inicio: string): string | null {
  return aHoraDePared(inicio)?.slice(0, 10) ?? null;
}

function esFechaDelDia(texto: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) && instanteDe(`${texto}T00:00:00`) !== null;
}

/**
 * Qué hacer con el evento de una OT cuya fecha puede haber cambiado.
 * `fechaNueva` es la que resuelve `fechaParaElCalendario` (la pendiente, si la
 * hay) o `null` si la orden quedó sin fecha.
 *
 * El orden de las preguntas importa: **vaciada** va antes que **divergió**
 * porque en los dos casos el evento no se toca, pero lo que hay que decir es
 * distinto, y sin fecha no hay nada contra qué comparar.
 */
export function queHacerConElEvento(
  evento: { inicio: string; turno: Turno | null; divergencia: string | null },
  fechaNueva: string | null
): QueHacer {
  const actual = fechaDelEvento(evento.inicio);
  const dondeEsta = actual ? `el evento sigue en el ${actual}` : "el evento no se tocó";

  if (fechaNueva === null) {
    return {
      accion: "avisar",
      motivo:
        `La planilla dejó la orden sin fecha de ejecución y ${dondeEsta}: borrarlo por eso sería adivinar. ` +
        `Hay que decidir si se borra el evento o se le vuelve a poner fecha a la orden.`,
    };
  }
  if (!esFechaDelDia(fechaNueva)) {
    return {
      accion: "avisar",
      motivo:
        `La orden tiene la fecha de ejecución «${fechaNueva}», que no es una fecha válida (AAAA-MM-DD), ` +
        `así que ${dondeEsta}.`,
    };
  }
  if (!actual) {
    return {
      accion: "avisar",
      motivo: `El evento tiene un inicio que no se puede leer («${evento.inicio}») y no se movió al ${fechaNueva}.`,
    };
  }

  if (actual === fechaNueva) {
    return { accion: "no tocar", motivo: `El evento ya está en el ${fechaNueva}` };
  }

  if (evento.divergencia) {
    const que = evento.divergencia === "borrado" ? "lo borraron" : "lo movieron";
    return {
      accion: "no tocar",
      motivo:
        `La orden pasó al ${fechaNueva}, pero este evento divergió en Google (${que}) y no se pisa: ` +
        `sigue en el ${actual}. Se destraba desde la Agenda.`,
    };
  }

  if (!evento.turno || !(TURNOS_DEL_TALLER as string[]).includes(evento.turno)) {
    return {
      accion: "avisar",
      motivo: `La orden pasó al ${fechaNueva} pero el evento no tiene un turno del taller, así que no se sabe a qué hora ponerlo.`,
    };
  }

  // El horario sale del turno y no del que tenía el evento: ver el punto 4 del encabezado.
  return { accion: "mover", ...horarioDeLaOT(fechaNueva, evento.turno) };
}

/**
 * Lo que la sincronización tiene que hacer con la fila, ya decidido.
 *
 * `aviso`: `undefined` no toca la columna, `null` la limpia, un texto la
 * escribe. Es de **esta** lógica: un aviso viejo que ya no corresponde (la
 * fecha volvió, el evento se movió) se limpia, así no queda una frase que dice
 * algo que dejó de ser cierto.
 */
export interface Plan {
  tipo: "mover" | "avisar" | "respetar" | "nada";
  mover: { inicio: string; fin: string } | null;
  aviso: string | null | undefined;
  /** Refrescar `divergencia_el`, para que la alerta que alguien ya dio por vista reaparezca. */
  volverAAlertar: boolean;
}

export interface FilaDeEventoDeOT {
  inicio: string;
  turno: Turno | null;
  divergencia: string | null;
  aviso: string | null;
  orden: {
    fecha_ejecucion: string | null;
    fecha_ejecucion_pendiente?: string | null;
    fecha_cierre: string | null;
    estado?: string | null;
  };
}

const NADA: Plan = { tipo: "nada", mover: null, aviso: undefined, volverAAlertar: false };

/**
 * Convierte la decisión en lo que se escribe. Va aparte de `queHacerConElEvento`
 * porque agrega lo que esa función no puede saber: si la OT está cerrada, si el
 * aviso ya estaba escrito, y si hay que volver a alertar.
 *
 * **Idempotente**: la sincronización corre cada pocos minutos, y un aviso que
 * se reescribe en cada corrida vuelve a alertar en cada corrida. Por eso el
 * aviso se compara con el que ya está: sólo lo que cambió se escribe, y
 * `volverAAlertar` sólo sale la primera vez que la orden se separa del evento.
 * El texto lleva las dos fechas, así que una segunda postergación sí es otra
 * novedad y vuelve a alertar.
 */
export function planDelEvento(fila: FilaDeEventoDeOT): Plan {
  // Cerrada: el evento pasado es el registro de lo que se planificó.
  //
  // **El predicado es `laOTEstaCerrada` de `evento.ts` y no se vuelve a escribir
  // a mano**: lo usan también la pantalla de mandar la OT y su ruta, y una regla
  // repetida se separa en la tercera copia. Esta ya se separó una vez: mirar sólo
  // `fecha_cierre` dejaba pasar 168 de 986 OT en `REALIZADO` (17 %, medido el
  // 03/11/2026), que seguían moviendo su evento futuro cada vez que la planilla
  // les tocaba la fecha.
  if (laOTEstaCerrada(fila.orden)) return NADA;

  const decision = queHacerConElEvento(fila, fechaParaElCalendario(fila.orden));

  if (decision.accion === "mover") {
    return {
      tipo: "mover",
      mover: { inicio: decision.inicio, fin: decision.fin },
      aviso: limpiable(fila.aviso) ? null : undefined,
      volverAAlertar: false,
    };
  }

  if (decision.accion === "avisar") {
    if (fila.aviso === decision.motivo) return NADA;
    return { tipo: "avisar", mover: null, aviso: decision.motivo, volverAAlertar: false };
  }

  // «No tocar» por divergencia: la orden y el evento están separados. Se
  // distingue de «ya está en esa fecha» mirando si de verdad difieren.
  const separados = Boolean(fila.divergencia) && fechaDelEvento(fila.inicio) !== fechaParaElCalendario(fila.orden);
  if (separados) {
    if (fila.aviso === decision.motivo) return NADA;
    return { tipo: "respetar", mover: null, aviso: decision.motivo, volverAAlertar: true };
  }

  return limpiable(fila.aviso) ? { ...NADA, aviso: null } : NADA;
}

/** ¿Hay un aviso que esta lógica escribió y que ya no corresponde? El de un borrado fallido no es de ella. */
function limpiable(aviso: string | null): boolean {
  return Boolean(aviso) && !aviso!.startsWith(AVISO_DE_BORRADO);
}

// ── La sincronización de OT mueve los eventos ───────────────────────────────

export interface LoQueSeguio {
  movidos: number;
  avisados: number;
  /** Eventos divergidos que se dejaron quietos aunque la orden cambió de fecha. */
  respetados: number;
  /** Fallos de escritura a Google que quedaron en la cola (`google_pendiente`). */
  pendientes: number;
  /** Lo que no se pudo ni guardar ni encolar. Quien llama lo tiene que mostrar. */
  fallos: string[];
}

interface FilaLeida {
  id: string;
  titulo: string;
  descripcion: string | null;
  lugar: string | null;
  inicio: string;
  fin: string;
  casilla: string;
  google_event_id: string | null;
  divergencia: string | null;
  aviso: string | null;
  turno: string | null;
  ot_id: string;
  ordenes_trabajo:
    | { ot_number: number; fecha_ejecucion: string | null; fecha_ejecucion_pendiente: string | null; fecha_cierre: string | null; estado: string | null }
    | { ot_number: number; fecha_ejecucion: string | null; fecha_ejecucion_pendiente: string | null; fecha_cierre: string | null; estado: string | null }[]
    | null;
}

/**
 * Mueve los eventos de las OT cuya fecha cambió. **Nunca tira**: se llama
 * después de importar las órdenes, que es lo que no puede fallar.
 *
 * Mira todos los eventos de OT y no sólo los de las órdenes que esta corrida
 * escribió, a propósito: es una decisión sobre el estado final de la base y no
 * sobre qué cambió en la lectura, así que da lo mismo si la fecha la movió la
 * planilla, un derrame que llegó tarde o una postergación hecha desde el SdG.
 * Son decenas de filas.
 */
export async function seguirALasOT(cliente: SupabaseClient, ahora: Date = new Date()): Promise<LoQueSeguio> {
  const r: LoQueSeguio = { movidos: 0, avisados: 0, respetados: 0, pendientes: 0, fallos: [] };

  let filas: FilaLeida[];
  try {
    filas = await traerTodo<FilaLeida>((desde, hasta) =>
      cliente.from("agenda_eventos")
        .select("id, titulo, descripcion, lugar, inicio, fin, casilla, google_event_id, divergencia, aviso, turno, ot_id, ordenes_trabajo!ot_id(ot_number, fecha_ejecucion, fecha_ejecucion_pendiente, fecha_cierre, estado)")
        .not("ot_id", "is", null)
        .order("id").range(desde, hasta).returns<FilaLeida[]>()
    );
  } catch (e) {
    r.fallos.push(`No se pudieron leer los eventos de las órdenes, así que no se movió ninguno: ${(e as Error).message}`);
    return r;
  }

  const marca = ahora.toISOString();

  for (const f of filas) {
    const orden = Array.isArray(f.ordenes_trabajo) ? f.ordenes_trabajo[0] : f.ordenes_trabajo;
    if (!orden) continue;
    const nombre = `OT ${orden.ot_number}`;

    try {
      const plan = planDelEvento({
        inicio: f.inicio,
        turno: TURNOS_DEL_TALLER.includes(f.turno as Turno) ? (f.turno as Turno) : null,
        divergencia: f.divergencia,
        aviso: f.aviso,
        orden,
      });
      if (plan.tipo === "nada" && plan.aviso === undefined) continue;

      if (plan.mover) {
        await moverElEvento(cliente, f, plan.mover, marca, nombre, r);
        continue;
      }

      const columnas: Record<string, unknown> = {};
      if (plan.aviso !== undefined) columnas.aviso = plan.aviso;
      // La divergencia se vuelve a fechar con el mismo valor: lo que cambia es
      // `divergencia_el`, y con eso reaparece la alerta ya dada por vista.
      if (plan.volverAAlertar && f.divergencia === "borrado") Object.assign(columnas, parDivergencia("borrado", marca));
      if (plan.volverAAlertar && f.divergencia === "movido") Object.assign(columnas, parDivergencia("movido", marca));

      const { error } = await cliente.from("agenda_eventos").update(columnas).eq("id", f.id);
      if (error) {
        r.fallos.push(`${nombre}: no se pudo anotar en su evento lo que pasó con la fecha: ${error.message}`);
        continue;
      }
      if (plan.tipo === "avisar") r.avisados += 1;
      if (plan.tipo === "respetar") r.respetados += 1;
    } catch (e) {
      r.fallos.push(`${nombre}: ${(e as Error).message}`);
    }
  }

  return r;
}

/**
 * La fila primero, después Google, después lo que Google dijo: el mismo orden
 * que la ruta de mandar una OT. El SdG es el dueño del dato, así que un fallo
 * de Google **no** deshace el movimiento: queda `google_pendiente`.
 */
async function moverElEvento(
  cliente: SupabaseClient,
  f: FilaLeida,
  nuevo: { inicio: string; fin: string },
  marca: string,
  nombre: string,
  r: LoQueSeguio
): Promise<void> {
  const inicio = aInstanteISO(nuevo.inicio);
  const fin = aInstanteISO(nuevo.fin);
  if (!inicio || !fin) {
    r.fallos.push(`${nombre}: el horario ${nuevo.inicio} / ${nuevo.fin} no es una fecha y hora válida`);
    return;
  }

  // `aviso: null` va con la fila: si había uno (la fecha estuvo vacía) ya no corresponde.
  const { error } = await cliente.from("agenda_eventos").update({ inicio, fin, aviso: null }).eq("id", f.id);
  if (error) {
    // Nada cambió: la próxima corrida lo vuelve a intentar.
    r.fallos.push(`${nombre}: no se pudo guardar el nuevo horario de su evento: ${error.message}`);
    return;
  }
  r.movidos += 1;

  const encolar = async (texto: string) => {
    r.pendientes += 1;
    const sinAnotar = await anotarEnLaFila(cliente, f.id, parPendiente(texto, marca));
    if (sinAnotar) {
      r.fallos.push(
        `${nombre}: el evento se movió en el SdG pero no en Google (${texto}), y tampoco se pudo anotar el pendiente: ${sinAnotar}`
      );
    }
  };

  const { data: invitados, error: errorDeInvitados } = await cliente
    .from("agenda_invitados").select("email").eq("evento_id", f.id);
  if (errorDeInvitados) {
    await encolar(`El evento de la OT se movió en el SdG pero no se pudieron leer los invitados, y Google no recibió nada: ${errorDeInvitados.message}`);
    return;
  }

  let evento;
  try {
    evento = eventoParaGoogle(
      { id: f.id, titulo: f.titulo, descripcion: f.descripcion, lugar: f.lugar, inicio, fin },
      (invitados ?? []).map((i: { email: string }) => i.email.toLowerCase()),
      f.casilla
    );
  } catch (e) {
    await encolar((e as Error).message);
    return;
  }

  // `crear` es idempotente y sirve para un evento que todavía no llegó a Google;
  // con id, `actualizar` es el PATCH.
  const enGoogle = await escribirEnGoogle(
    f.google_event_id ? "actualizar" : "crear",
    { casilla: f.casilla, google_event_id: f.google_event_id, inicio, fin },
    evento
  );

  // Lo que Google devolvió, no lo que se mandó (punto 5 del encabezado).
  const errorAlAnotar = await anotarEnLaFila(cliente, f.id, columnasDespuesDeEscribir(enGoogle, marca));
  if (enGoogle.pendiente) r.pendientes += 1;
  if (errorAlAnotar) {
    r.fallos.push(
      `${nombre}: no se pudo anotar lo que dijo Google sobre su evento, ni en dos intentos (${errorAlAnotar}). ` +
        (enGoogle.pendiente
          ? "El evento sigue sin estar en Google."
          : "Si Google ya tiene el cambio, la Agenda puede avisar de un movimiento que no es real.")
    );
  }
}

// ── El borrado de espejo borra los eventos antes que las OT ─────────────────

/**
 * Borra en Google los eventos de las OT que están por borrarse, y devuelve las
 * que **no se pueden borrar todavía**: `id de la OT` → por qué.
 *
 * POR QUÉ VA ANTES, Y POR QUÉ UN FALLO FRENA LA OT
 *
 * Un evento que sobrevive a su fila queda vivo en cinco calendarios y **nadie
 * puede sacarlo nunca más desde el sistema**: no queda ninguna fila que nombre
 * su `google_event_id`. El `on delete cascade` de `agenda_eventos.ot_id` se
 * lleva la fila pero no la copia de Google. Por eso si el borrado en Google
 * falla, esa OT no se borra en esta corrida y se reintenta en la próxima: es la
 * misma forma que el registro de auditoría de `borradoDeEspejo` —si no entra,
 * no se borra—, con un motivo más fuerte, porque acá lo que se perdería no es
 * un rastro sino la única forma de alcanzar el evento.
 *
 * Se borra aunque el evento haya divergido, o la OT esté cerrada: lo que se
 * decidió no pisar es **mover** un evento, y acá la orden ya no existe.
 *
 * Un fallo se anota también en el evento, para que se vea en la Agenda, **en
 * `aviso` y NO en `google_pendiente`**. `google_pendiente` significa «falta
 * escribir esto en Google» y el cron de la Tarea 9 lo reintenta escribiendo: a
 * un evento que se quería borrar lo resucitaría. `aviso` es justamente lo que
 * una persona tiene que mirar y no es ni un fallo de escritura ni una
 * divergencia, y el reintento no lo necesita: lo hace la próxima sincronización
 * de OT, que vuelve a encontrar a la OT como candidata.
 *
 * Sin `google_event_id` igual se intenta: crear usa un id que sale de la fila
 * (`idDeGoogleDe`), así que un alta que llegó a Google y no se pudo anotar
 * deja un evento que sólo se encuentra por ese id. Borrar es idempotente: si no
 * existe, es éxito.
 *
 * **Nunca tira**: si no puede ni mirar qué eventos hay, todas las OT del lote
 * quedan sin borrar.
 */
export async function borrarLosEventosDeLasOT(
  cliente: SupabaseClient,
  otIds: readonly string[],
  ahora: Date = new Date()
): Promise<Map<string, string>> {
  const noSePuede = new Map<string, string>();
  const marca = ahora.toISOString();

  // De a 200: un `.in()` con muchos ids arma una URL que PostgREST rechaza.
  for (let i = 0; i < otIds.length; i += 200) {
    const lote = otIds.slice(i, i + 200);

    const { data, error } = await cliente
      .from("agenda_eventos")
      .select("id, ot_id, casilla, google_event_id, inicio, fin")
      .in("ot_id", lote);
    if (error) {
      for (const id of lote) {
        noSePuede.set(id, `No se pudo mirar si la orden tiene un evento en la Agenda: ${error.message}`);
      }
      continue;
    }

    for (const ev of (data ?? []) as {
      id: string; ot_id: string; casilla: string; google_event_id: string | null; inicio: string; fin: string;
    }[]) {
      const r = await escribirEnGoogle("borrar", {
        casilla: ev.casilla,
        google_event_id: ev.google_event_id ?? idDeGoogleDe(ev.id),
        inicio: ev.inicio,
        fin: ev.fin,
      });
      if (!r.pendiente) continue;

      const texto = `${AVISO_DE_BORRADO}. Google dijo: ${r.pendiente}`;
      const sinAnotar = await anotarEnLaFila(cliente, ev.id, { aviso: texto });
      noSePuede.set(
        ev.ot_id,
        sinAnotar ? `${texto} (y tampoco se pudo anotar el aviso en el evento: ${sinAnotar})` : texto
      );
    }
  }

  return noSePuede;
}
