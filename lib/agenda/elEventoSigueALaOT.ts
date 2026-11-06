import type { SupabaseClient } from "@supabase/supabase-js";
import type { Turno } from "@/lib/mantenimiento/programacion";
import { traerTodo } from "@/lib/core/paginado";
import { fechaParaElCalendario, horarioDeLaOT, instanteDe, laOTEstaCerrada, TURNOS_DEL_TALLER } from "./evento";
import { AVISO_DE_TOPE, claveDelHueco, horarioApilado } from "./apilado";
import { leerEvento, type EventoParaGoogle } from "@/lib/core/calendar";
import { aHoraDePared, aInstanteISO, eventoParaGoogle, idDeGoogleDe, invitadosLimpios } from "./pedido";
import {
  columnasDespuesDeEscribir, columnasDeUnBorradoFallido, escribirEnGoogle, parDivergencia, parPendiente,
} from "./escribirEnGoogle";
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
 *    **Y el hueco se recalcula en la fecha nueva** (`ocupados`): conservar la
 *    hora fija del turno hacía que una orden que pasa del 6 al 20 cayera
 *    exactamente encima de otra de su especialidad, que es lo que el apilado
 *    existe para evitar —y nada lo habría avisado—.
 * 5. **`escrito` guarda lo que Google devolvió, nunca lo que se mandó**
 *    (`columnasDespuesDeEscribir`): es lo único que distingue el eco de una
 *    escritura propia de un cambio hecho por una persona.
 * 6. **El apilado agrupa por turno, y dos turnos vecinos se pueden solapar en
 *    el borde. Está dicho y no resuelto, a propósito.** El grupo es
 *    `claveDelHueco` —día, especialidad **y** turno—, así que las de 4-12 y
 *    las de 8-16 se apilan por separado: la cuarta del turno de 4 arranca a
 *    las 08:30 y se pisa con una de 8-16 que vaya de 08:00 a 09:30. Se deja
 *    así por tres razones: el usuario ya decidió no resolver el borde de
 *    amontonamiento; el camino automático usa **un solo turno**, así que para
 *    que pase hacen falta además eventos puestos a mano en otro turno el mismo
 *    día y de la misma especialidad; y arreglarlo de verdad sería contar los
 *    tres turnos juntos, o sea abandonar la partición por turno, que es
 *    justamente lo que protege el turno que una persona eligió.
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
  /** `topeado` sólo está cuando el hueco nuevo cayó contra las 20:00 (`AVISO_DE_TOPE`). */
  | { accion: "mover"; inicio: string; fin: string; topeado?: true }
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
 * La hora de pared a la que arranca un turno. Sale de `horarioDeLaOT` y no de
 * una tabla propia: una segunda tabla de turnos es cómo dos cosas iguales se
 * separan sin que nada avise. La fecha da lo mismo, sólo se usa la hora.
 */
function arranqueDelTurno(turno: Turno): string {
  return horarioDeLaOT("2000-01-01", turno).inicio.slice(11, 16);
}

/**
 * Qué hacer con el evento de una OT cuya fecha puede haber cambiado.
 * `fechaNueva` es la que resuelve `fechaParaElCalendario` (la pendiente, si la
 * hay) o `null` si la orden quedó sin fecha.
 *
 * El orden de las preguntas importa: **vaciada** va antes que **divergió**
 * porque en los dos casos el evento no se toca, pero lo que hay que decir es
 * distinto, y sin fecha no hay nada contra qué comparar.
 *
 * `ocupados` son los eventos de la misma especialidad que ya hay en la fecha
 * nueva **en ese mismo turno**, sin contar a éste. Es lo único que esta función
 * no puede saber sola: lo cuenta `seguirALasOT`, que es la que leyó las filas.
 * En cero —el valor por defecto— el evento cae en la hora de su turno, que es
 * lo que hacía antes.
 */
export function queHacerConElEvento(
  evento: { inicio: string; turno: Turno | null; divergencia: string | null },
  fechaNueva: string | null,
  ocupados: number = 0
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

  // El horario sale del turno y no del que tenía el evento, y apilado sobre lo
  // que ya hay en el día nuevo: ver el punto 4 del encabezado.
  const apilado = horarioApilado(fechaNueva, ocupados, arranqueDelTurno(evento.turno));
  // No debería pasar: la fecha ya se validó arriba y el arranque sale del turno.
  if (!apilado) return { accion: "mover", ...horarioDeLaOT(fechaNueva, evento.turno) };
  return {
    accion: "mover",
    inicio: apilado.inicio,
    fin: apilado.fin,
    ...(apilado.topeado ? { topeado: true as const } : {}),
  };
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
export function planDelEvento(fila: FilaDeEventoDeOT, ocupados: number = 0): Plan {
  // Cerrada: el evento pasado es el registro de lo que se planificó.
  //
  // **El predicado es `laOTEstaCerrada` de `evento.ts` y no se vuelve a escribir
  // a mano**: lo usan también la pantalla de mandar la OT y su ruta, y una regla
  // repetida se separa en la tercera copia. Esta ya se separó una vez: mirar sólo
  // `fecha_cierre` dejaba pasar 168 de 986 OT en `REALIZADO` (17 %, medido el
  // 03/11/2026), que seguían moviendo su evento futuro cada vez que la planilla
  // les tocaba la fecha.
  if (laOTEstaCerrada(fila.orden)) return NADA;

  const decision = queHacerConElEvento(fila, fechaParaElCalendario(fila.orden), ocupados);

  if (decision.accion === "mover") {
    return {
      tipo: "mover",
      mover: { inicio: decision.inicio, fin: decision.fin },
      aviso: avisoDeUnMovimiento(fila.aviso, Boolean(decision.topeado)),
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

/**
 * ¿Hay un aviso que esta lógica escribió y que ya no corresponde?
 *
 * **La columna `aviso` de un evento de OT tiene tres escritores y cada uno
 * limpia sólo lo suyo.** Dos no son de esta lógica y por eso están exceptuados:
 *
 * - El de un **borrado que Google rechazó** (`AVISO_DE_BORRADO`, por prefijo:
 *   el texto le agrega lo que dijo Google). Lo escribe `borrarLosEventosDeLasOT`
 *   justo antes de que esta pasada corra, así que sin la excepción se limpiaría
 *   en la misma corrida que lo escribió.
 * - El de **la orden que quedó contra el tope de las 20:00** (`AVISO_DE_TOPE`,
 *   por igualdad: se escribe tal cual). Lo escribe `mandarLaOTAlCalendario`, y
 *   para una OT en estado normal —nada que mover, sin divergencia— esta pasada
 *   lo borraba en la primera corrida. Eso importa porque **en el camino
 *   automático la copia en `aviso` es el único canal**: `alNacerLaOT` devuelve
 *   una advertencia en texto y el importador no tiene a quién mostrársela.
 *
 * La excepción del tope vale **mientras el evento no se mueva**: desde que el
 * barrido recalcula el hueco, al mover esa frase sí la decide esta lógica y la
 * resuelve `avisoDeUnMovimiento`. Acá, con el evento quieto, sigue sin saber si
 * el tope es cierto, así que no lo toca.
 */
function limpiable(aviso: string | null): boolean {
  return Boolean(aviso) && !aviso!.startsWith(AVISO_DE_BORRADO) && aviso !== AVISO_DE_TOPE;
}

/**
 * El `aviso` que le queda a un evento que se mueve de día, ahora que el hueco
 * se recalcula: `undefined` no toca la columna, `null` la limpia.
 *
 * **Al mover, el tope lo decide esta pasada y por eso también lo limpia.** Es
 * la mitad que `limpiable` no puede tener: ahí el aviso del tope está exceptuado
 * porque para un evento que no se toca esta lógica no sabe si sigue siendo
 * cierto, y lo escribió `mandarLaOTAlCalendario`. Al mover sí lo sabe —acaba de
 * calcular el hueco del día nuevo—, así que lo escribe si topea y lo saca si no:
 * dejarlo sería dejar escrita una frase que dejó de ser cierta, que es
 * exactamente lo que esta columna no puede tener. Es la misma forma que el
 * `delTope` de `mandarLaOT.ts`.
 *
 * **Pero el aviso de un borrado fallido gana siempre, también contra el del
 * tope.** Escribirle `AVISO_DE_TOPE` encima lo pierde igual que limpiarlo a
 * ciegas, y los dos no valen lo mismo: el del borrado es el único registro de
 * que quedó un evento vivo en cinco calendarios que **ya ninguna fila nombra**
 * y que no se recupera de ningún lado; el del tope dice que la orden comparte
 * las 20:00, que se vuelve a deducir mirando el horario. Así que con un
 * borrado fallido guardado esta función no toca la columna, topee o no.
 */
function avisoDeUnMovimiento(aviso: string | null, topeado: boolean): string | null | undefined {
  if (aviso?.startsWith(AVISO_DE_BORRADO)) return undefined;
  if (topeado) return aviso === AVISO_DE_TOPE ? undefined : AVISO_DE_TOPE;
  if (aviso === AVISO_DE_TOPE) return null;
  return limpiable(aviso) ? null : undefined;
}

// ── La sincronización de OT mueve los eventos ───────────────────────────────

export interface LoQueSeguio {
  movidos: number;
  avisados: number;
  /** Eventos divergidos que se dejaron quietos aunque la orden cambió de fecha. */
  respetados: number;
  /** Fallos de escritura a Google que quedaron en la cola (`google_pendiente`). */
  pendientes: number;
  /** Movimientos que no se alcanzaron a hacer porque se agotó el tiempo: la próxima corrida los hace. */
  sinAlcanzar: number;
  /**
   * **Quién se comió el tiempo**, si se sabe: la OT cuyo movimiento dejó el
   * presupuesto agotado, con lo que tardó (`quienSeComioElTiempo`). Sólo está si
   * hubo `sinAlcanzar`. Sin esto «quedaron 3 sin mover» no dice por dónde
   * empezar a mirar, y una OT lenta que se repite cada corrida es indistinguible
   * de un Google lento.
   */
  seComioElTiempo?: string;
  /** Lo que no se pudo ni guardar ni encolar. Quien llama lo tiene que mostrar. */
  fallos: string[];
}

/**
 * Cuánto se le dedica a Google en total, **entre borrar y mover**.
 *
 * **Estos dos caminos corren adentro de la sincronización de OT, que corre
 * adentro del cron de Mantenimiento, que corre las cinco sincronizaciones en una
 * sola invocación de 300 segundos.** Cada llamada a Google corta a los 30 s
 * (`CORTE_MS` de `calendar.ts`) y las de acá son secuenciales: con Google sin
 * contestar, diez eventos son 300 s exactos y las otras cuatro sincronizaciones
 * —que no tienen nada que ver con la Agenda— no llegan a correr. Lo que no se
 * alcanza a hacer se hace en la corrida siguiente; lo que no puede pasar es que
 * la Agenda tumbe lo que ya funcionaba.
 *
 * **Es un solo presupuesto para las dos funciones** (`presupuestoDeGoogle`) y no
 * uno cada una: con 60 s para cada una, el peor caso eran unos 240 s de los 300,
 * y quedaban 60 para las otras cuatro, que es justo lo que esto protege.
 *
 * **Y el borrado no se lo puede comer entero**: gasta a lo sumo la mitad
 * (`borrar`), y a `seguirALasOT` le queda garantizada la otra mitad **contada
 * desde que ella empieza** (`mover`). Sin esa reserva, una OT cuyo `DELETE` da
 * timeout siempre —y que por eso no se borra— vuelve a ser la primera de la
 * lista en cada corrida, agota los 30 s y ningún evento se mueve **nunca**, sin
 * que ninguna pantalla lo muestre. Con la reserva, esa OT se lleva su parte y no
 * la de todos; y si Google está caído de verdad, el primer evento que se intenta
 * mover deja un `google_pendiente`, que sí se ve en la Agenda.
 *
 * EL PEOR CASO, CON LA CUENTA. El límite se mira **antes** de empezar un evento
 * y no corta a mitad de uno, así que se pasa por lo que tarde el que está en
 * curso:
 * - borrar: una sola llamada (`borrarEvento`, 30 s). Empieza a lo sumo a los
 *   15 s y termina a los 45.
 * - mover un evento **sin `google_event_id`**: cuatro llamadas —`leerEvento` de
 *   los invitados (`moverElEvento`), el `POST` de `crearEvento`, **el
 *   `leerEvento` que `crearEvento` hace por dentro cuando recibe el 409**, y el
 *   `PUT` de `restaurar`—, 4 × 30 s = 120 s. Con `google_event_id` es un solo
 *   `PATCH`.
 * Un evento que arranca a los 14,9 s de su mitad y encadena cuatro llamadas
 * lentas cierra a 15 + 120 = 135 s, y sumado al borrado la Agenda llega a unos
 * **180 s de los 300** en el peor caso imaginable (Google contestando cada
 * llamada justo antes del corte). Con Google colgado de verdad es mucho menos:
 * el primer evento que no tiene id cuesta 30 s y agota la mitad.
 */
export const LIMITE_DE_GOOGLE_MS = 30_000;

/** El tiempo que le queda a la Agenda para hablar con Google en esta corrida. */
export interface PresupuestoDeGoogle {
  agotado(): boolean;
}

/** Los dos tramos del presupuesto de una corrida: ver `LIMITE_DE_GOOGLE_MS`. */
export interface PresupuestoDeLaCorrida {
  /** Para `borrarLosEventosDeLasOT`: se agota a la mitad. */
  borrar: PresupuestoDeGoogle;
  /** Para `seguirALasOT`: el resto, y como mínimo la mitad desde que ella empieza. */
  mover: PresupuestoDeGoogle;
}

/** Arranca el reloj. Se crea **una vez por corrida** y se le pasa un tramo a cada función. */
export function presupuestoDeGoogle(
  limiteMs: number = LIMITE_DE_GOOGLE_MS,
  reloj: () => number = Date.now
): PresupuestoDeLaCorrida {
  const inicio = reloj();
  const mitad = limiteMs / 2;
  let empezoAMover: number | null = null;
  return {
    borrar: { agotado: () => reloj() >= inicio + mitad },
    mover: {
      agotado: () => {
        // Si el borrado se pasó de su mitad (una llamada lenta lo puede hacer),
        // el movimiento igual cuenta con su mitad completa desde que empieza.
        empezoAMover ??= reloj();
        return reloj() >= Math.max(inicio + limiteMs, empezoAMover + mitad);
      },
    },
  };
}

export interface OpcionesDeLaPasada {
  ahora?: Date;
  /** El tramo de `presupuestoDeGoogle` que le toca; si falta, la función arranca uno propio. */
  presupuesto?: PresupuestoDeGoogle;
  /** El reloj con el que se mide cuánto tarda cada llamada a Google (`Date.now`; se inyecta en los tests). */
  reloj?: () => number;
}

/**
 * Cómo se nombra a quien se comió el tiempo: «OT 2910, cuyo borrado tardó 31 s». El
 * movimiento la nombra por número (`seguirALasOT` ya tiene la orden en la mano); el
 * borrado, por id. `ot` es el número de la orden o, si no se pudo leer, lo que
 * haya (un id). **Existe porque una OT cuyo `DELETE` da timeout consume su parte
 * del presupuesto en cada corrida, y las que están detrás no se borran**:
 * está aceptado como limitación, pero tiene que poder leerse en
 * `sincronizaciones` *cuál* es, o quien la mire no sabe a quién buscarle el
 * problema.
 */
export function quienSeComioElTiempo(ot: string, que: "borrado" | "movimiento", ms: number): string {
  return `${ot}, cuyo ${que} tardó ${Math.max(1, Math.round(ms / 1000))} s`;
}

/**
 * Lo que de una pasada hay que dejar en el registro de `sincronizaciones`, o
 * `null` si no hay nada que decir.
 *
 * **Con `fallos` la corrida sale en rojo; con sólo `sinAlcanzar`, no, pero el
 * texto queda escrito.** Lo que se difiere por falta de tiempo no es un fallo,
 * pero con Google caído varios días los eventos que nunca se alcanzan a mover se
 * posponen en silencio corrida tras corrida: los que sí se intentan al menos
 * quedan con pendiente y ésos se ven, éstos no tienen ni eso.
 */
export function loQueSeAnotaDeLosEventos(
  e: Pick<LoQueSeguio, "fallos" | "sinAlcanzar" | "seComioElTiempo">
): { ok: boolean; error: string } | null {
  const partes: string[] = [];
  if (e.fallos.length > 0) {
    partes.push(`Las órdenes se guardaron pero no se pudo seguir con los eventos de la Agenda: ${e.fallos.join(" | ")}`);
  }
  if (e.sinAlcanzar > 0) {
    partes.push(
      `Quedaron ${e.sinAlcanzar} eventos de la Agenda sin mover porque se agotó el tiempo que se le dedica a ` +
        `Google en una corrida${e.seComioElTiempo ? ` (se lo llevó la ${e.seComioElTiempo})` : ""}; ` +
        `se mueven en la próxima`
    );
  }
  return partes.length === 0 ? null : { ok: e.fallos.length === 0, error: partes.join(". ") };
}

interface OrdenLeida {
  ot_number: number;
  fecha_ejecucion: string | null;
  fecha_ejecucion_pendiente: string | null;
  fecha_cierre: string | null;
  estado: string | null;
  especialidad: string | null;
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
  ordenes_trabajo: OrdenLeida | OrdenLeida[] | null;
}

/** El embed de Supabase viene como objeto o como lista de uno, según la relación. */
function laOrdenDe(f: FilaLeida): OrdenLeida | null {
  return (Array.isArray(f.ordenes_trabajo) ? f.ordenes_trabajo[0] : f.ordenes_trabajo) ?? null;
}

/** El turno guardado, si es uno de los tres del taller. */
function turnoDelTaller(turno: string | null): Turno | null {
  return TURNOS_DEL_TALLER.includes(turno as Turno) ? (turno as Turno) : null;
}

/**
 * Qué eventos hay en cada grupo, **armado con las filas que la pasada ya leyó**:
 * no cuesta ni una lectura más, y por lo tanto nada del presupuesto que
 * `LIMITE_DE_GOOGLE_MS` reserva. `seguirALasOT` trae todos los eventos con
 * `ot_id`, que son exactamente los que cuentan para el apilado (los de la
 * Agenda sin orden no entran, igual que en `mandarLaOTAlCalendario`).
 *
 * Guarda los ids y no un número porque lo que se le pregunta es «cuántos hay
 * **sin contarme a mí**».
 *
 * **Un evento sin un turno del taller no ocupa ningún grupo**: no se sabe en
 * cuál ponerlo, y repartirlo entre los tres sería inventarlo. Es el mismo
 * evento que `queHacerConElEvento` se niega a mover por no saber a qué hora
 * ponerlo, así que lo que queda es que otro pueda caerle encima; se prefiere
 * eso a correr órdenes por una suposición.
 */
function cuposDeLasFilas(filas: FilaLeida[]): Map<string, Set<string>> {
  const cupos = new Map<string, Set<string>>();
  for (const f of filas) {
    const fecha = fechaDelEvento(f.inicio);
    const turno = turnoDelTaller(f.turno);
    if (!fecha || !turno) continue;
    tomarElCupo(cupos, claveDelHueco(fecha, laOrdenDe(f)?.especialidad, turno), f.id);
  }
  return cupos;
}

/** Cuántos hay en ese grupo sin contar al evento `propio`. */
function ocupadosEn(cupos: Map<string, Set<string>>, clave: string, propio: string): number {
  const grupo = cupos.get(clave);
  if (!grupo) return 0;
  return grupo.size - (grupo.has(propio) ? 1 : 0);
}

/** El evento pasa a ocupar ese grupo, para los que se decidan después que él. */
function tomarElCupo(cupos: Map<string, Set<string>>, clave: string, evento: string): void {
  const grupo = cupos.get(clave);
  if (grupo) grupo.add(evento);
  else cupos.set(clave, new Set([evento]));
}

/**
 * Mueve los eventos de las OT cuya fecha cambió. **Nunca tira**: se llama
 * después de importar las órdenes, que es lo que no puede fallar. Y **no pasa de
 * `LIMITE_DE_GOOGLE_MS`**: ver esa constante.
 *
 * Mira todos los eventos de OT y no sólo los de las órdenes que esta corrida
 * escribió, a propósito: es una decisión sobre el estado final de la base y no
 * sobre qué cambió en la lectura, así que da lo mismo si la fecha la movió la
 * planilla, un derrame que llegó tarde o una postergación hecha desde el SdG.
 * Son decenas de filas.
 *
 * LO QUE SE LE ESCRIBE A GOOGLE: el evento entero —título, descripción, lugar,
 * horario e invitados— tal como está en la fila, con un PATCH. En régimen es un
 * no-op para todo menos el horario, porque los dos lados dicen lo mismo; pero
 * **lo que se decide mover es sólo el horario**, y por eso una lista de
 * invitados que vuelve sin filas **no se manda**: `attendees: []` en un PATCH
 * borra a los invitados y les manda la cancelación, y la ruta de la OT deja a
 * propósito eventos cuyos invitados no se pudieron guardar. **Esa omisión sólo
 * vale para el PATCH**: en un PUT, omitir `attendees` es «no hay» y los pierde
 * (ver `EventoParaGoogle.invitados`), así que si el camino es `crear` —sin
 * `google_event_id`— se leen antes de Google y se reusan.
 */
export async function seguirALasOT(
  cliente: SupabaseClient,
  { ahora = new Date(), presupuesto = presupuestoDeGoogle().mover, reloj = Date.now }: OpcionesDeLaPasada = {}
): Promise<LoQueSeguio> {
  const r: LoQueSeguio = { movidos: 0, avisados: 0, respetados: 0, pendientes: 0, sinAlcanzar: 0, fallos: [] };

  let filas: FilaLeida[];
  try {
    filas = await traerTodo<FilaLeida>((desde, hasta) =>
      cliente.from("agenda_eventos")
        // La cadena va literal y en una sola pieza: partida con `+` pierde la
        // inferencia de tipos de Supabase.
        .select("id, titulo, descripcion, lugar, inicio, fin, casilla, google_event_id, divergencia, aviso, turno, ot_id, ordenes_trabajo!ot_id(ot_number, fecha_ejecucion, fecha_ejecucion_pendiente, fecha_cierre, estado, especialidad)")
        .not("ot_id", "is", null)
        .order("id").range(desde, hasta).returns<FilaLeida[]>()
    );
  } catch (e) {
    r.fallos.push(`No se pudieron leer los eventos de las órdenes, así que no se movió ninguno: ${(e as Error).message}`);
    return r;
  }

  const marca = ahora.toISOString();
  const cupos = cuposDeLasFilas(filas);

  for (const f of filas) {
    const orden = laOrdenDe(f);
    if (!orden) continue;
    const nombre = `OT ${orden.ot_number}`;

    try {
      const turno = turnoDelTaller(f.turno);
      // El hueco del día al que la orden se mudó. Sin esto el evento llegaría
      // con la hora fija de su turno y caería encima de otro de su especialidad.
      const fechaNueva = fechaParaElCalendario(orden);
      const destino = fechaNueva && turno ? claveDelHueco(fechaNueva, orden.especialidad, turno) : null;

      const plan = planDelEvento(
        { inicio: f.inicio, turno, divergencia: f.divergencia, aviso: f.aviso, orden },
        destino ? ocupadosEn(cupos, destino, f.id) : 0
      );
      if (plan.tipo === "nada" && plan.aviso === undefined) continue;

      if (plan.mover) {
        // Sin tiempo no se empieza: la fila queda como estaba y la próxima
        // corrida lo mueve. Lo que cuesta es hablar con Google; lo demás es base.
        if (presupuesto.agotado()) {
          r.sinAlcanzar += 1;
          continue;
        }
        const desde = reloj();
        const movidosAntes = r.movidos;
        await moverElEvento(cliente, f, plan.mover, plan.aviso, marca, nombre, r);
        // El hueco queda tomado para los que vengan detrás en esta misma corrida:
        // una planilla que corre tres OT del 6 al 20 las pondría a las tres a la
        // misma hora. Sólo si la fila de verdad se movió —si el `update` falló, el
        // evento sigue en su día viejo y el hueco del nuevo no está tomado—.
        //
        // No se lo saca del grupo del día viejo: contarlo de más deja un hueco
        // libre en el medio, que la spec acepta; contarlo de menos encima dos
        // eventos, que es lo que esto evita.
        if (destino && r.movidos > movidosAntes) tomarElCupo(cupos, destino, f.id);
        // El primero que deja el presupuesto agotado es quien se lo comió.
        if (r.seComioElTiempo === undefined && presupuesto.agotado()) {
          r.seComioElTiempo = quienSeComioElTiempo(nombre, "movimiento", reloj() - desde);
        }
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
 *
 * **El pendiente se escribe en el mismo `update` que el horario nuevo**, y se
 * limpia al volver de Google (`columnasDespuesDeEscribir`). Entre el `update` y
 * la escritura hay una ventana en la que la invocación puede morir (timeout,
 * deploy): sin pendiente quedaría la fila con el día nuevo, Google con el viejo
 * y `escrito` con el viejo, y nadie lo vería —la corrida siguiente compara la
 * fila contra la OT y coinciden; el webhook compara `escrito` contra Google y
 * coinciden—. Con el pendiente, esa muerte deja algo que el cron levanta.
 */
async function moverElEvento(
  cliente: SupabaseClient,
  f: FilaLeida,
  nuevo: { inicio: string; fin: string },
  aviso: string | null | undefined,
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

  // El aviso es el que decidió `planDelEvento`: limpia el que esta lógica
  // escribió y deja el de un borrado fallido (`AVISO_DE_BORRADO`), que no es suyo.
  const { error } = await cliente.from("agenda_eventos").update({
    inicio, fin,
    ...(aviso !== undefined ? { aviso } : {}),
    ...parPendiente(
      "El evento se movió en el SdG y todavía no se confirmó la escritura en Google: si este aviso sigue acá, no terminó",
      marca
    ),
  }).eq("id", f.id);
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

  let evento: EventoParaGoogle;
  try {
    const correos = (invitados ?? []).map((i: { email: string }) => i.email.toLowerCase());
    const completo = eventoParaGoogle(
      { id: f.id, titulo: f.titulo, descripcion: f.descripcion, lugar: f.lugar, inicio, fin },
      correos,
      f.casilla
    );
    // Cero filas no es «no hay invitados»: es que no se sabe quiénes son, y
    // mandar `[]` en un PATCH los borra y les manda la cancelación.
    //
    // Se pregunta por `completo.invitados` y no por `correos`: `eventoParaGoogle`
    // saca al dueño (`invitadosLimpios`), así que una fila cuyo único invitado
    // fuera la propia casilla daría un `correos` de uno y un `completo` vacío, y
    // un PATCH con `attendees: []`.
    evento = completo.invitados && completo.invitados.length > 0 ? completo : { ...completo, invitados: undefined };
  } catch (e) {
    await encolar((e as Error).message);
    return;
  }

  // **Sin `google_event_id` el camino es `crear`, y `crear` puede terminar en un
  // PUT** (si el id ya estaba en Google: el alta llegó y el `update` de la fila
  // no). Un PUT reemplaza el recurso entero, así que `invitados: undefined` —que
  // en un PATCH es «no los toques»— ahí es «no hay» y pierde a los cinco con la
  // cancelación. Si no sabemos quiénes son, se leen de Google y se reusan. No
  // existe todavía (`null`): se crea sin invitados, y no hay nada que perder.
  // Negarse a escribir lo dejaría pendiente para siempre: el reintento se
  // encontraría con lo mismo. Es el camino angosto de dos hipos de red juntos.
  if (evento.invitados === undefined && !f.google_event_id) {
    try {
      const enGoogle = await leerEvento(f.casilla, evento.id ?? idDeGoogleDe(f.id));
      // Por el mismo filtro que los de la fila: Google devuelve al organizador
      // entre los `attendees`, y no se lo reescribe como invitado de su evento.
      if (enGoogle) evento = { ...evento, invitados: invitadosLimpios(enGoogle.invitados.map((i) => i.email), f.casilla) };
    } catch (e) {
      await encolar(
        `No se pudieron leer los invitados que el evento ya tiene en Google, y escribirlo sin ellos los borraría: ${(e as Error).message}`
      );
      return;
    }
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
 * quedan sin borrar. Y **no pasa de `LIMITE_DE_GOOGLE_MS`** (ver esa constante):
 * al agotarse, las OT con evento que faltan quedan sin borrar y se reintentan
 * en la próxima corrida.
 */
export async function borrarLosEventosDeLasOT(
  cliente: SupabaseClient,
  otIds: readonly string[],
  { ahora = new Date(), presupuesto = presupuestoDeGoogle().borrar, reloj = Date.now }: OpcionesDeLaPasada = {}
): Promise<Map<string, string>> {
  const noSePuede = new Map<string, string>();
  const marca = ahora.toISOString();
  // La OT cuyo borrado dejó el presupuesto agotado, para nombrarla en el motivo de
  // todas las que se quedaron sin borrar por eso (ver `quienSeComioElTiempo`).
  let seComioElTiempo: string | null = null;
  const sinTiempo = () =>
    "Se agotó el tiempo que se le dedica a Google en una corrida" +
    (seComioElTiempo ? ` (se lo llevó la ${seComioElTiempo})` : "") +
    ": se borra en la próxima";

  // De a 200: un `.in()` con muchos ids arma una URL que PostgREST rechaza.
  for (let i = 0; i < otIds.length; i += 200) {
    const lote = otIds.slice(i, i + 200);

    // Sin tiempo, ni siquiera se mira: ninguna OT del lote se borra.
    if (presupuesto.agotado()) {
      for (const id of lote) noSePuede.set(id, sinTiempo());
      continue;
    }

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
      // Las OT del lote sin evento no cuestan nada y se borran igual; la que
      // tiene evento y no alcanza el tiempo se queda.
      if (presupuesto.agotado()) {
        noSePuede.set(ev.ot_id, sinTiempo());
        continue;
      }
      const desde = reloj();
      const r = await escribirEnGoogle("borrar", {
        casilla: ev.casilla,
        google_event_id: ev.google_event_id ?? idDeGoogleDe(ev.id),
        inicio: ev.inicio,
        fin: ev.fin,
      });
      // El primero que deja el presupuesto agotado es quien se lo comió: sea porque
      // falló o porque salió bien pero lento, es el que hay que ir a mirar.
      if (seComioElTiempo === null && presupuesto.agotado()) {
        // Por id y no por número de orden, a propósito: leer el número pediría un embed en
        // este `select`, y si no resolviera en producción **ninguna OT se borraría**. Un
        // texto más legible no vale poner el borrado de espejo a depender de eso.
        seComioElTiempo = quienSeComioElTiempo(`OT ${ev.ot_id}`, "borrado", reloj() - desde);
      }
      if (!r.pendiente) continue;

      const texto = `${AVISO_DE_BORRADO}. Google dijo: ${r.pendiente}`;
      // El aviso **y el pendiente limpio**, en el mismo update: si la fila traía un
      // `google_pendiente`, el cron lo tomaría y haría `crear`/`actualizar` sobre el
      // evento que el sistema quiso borrar. El texto es el de acá y no el de la ruta
      // de la Agenda: `limpiable()` depende del prefijo `AVISO_DE_BORRADO`.
      const sinAnotar = await anotarEnLaFila(cliente, ev.id, columnasDeUnBorradoFallido(r.pendiente, marca, texto));
      noSePuede.set(
        ev.ot_id,
        sinAnotar ? `${texto} (y tampoco se pudo anotar el aviso en el evento: ${sinAnotar})` : texto
      );
    }
  }

  return noSePuede;
}
