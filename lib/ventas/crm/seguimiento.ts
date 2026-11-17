import { sumarDias } from "@/lib/core/fechas";

/**
 * Lo que convierte el registro de actividades en una agenda.
 *
 * Dos preguntas distintas, y conviene no confundirlas:
 *
 *   1. **¿Qué tengo que hacer?** — los próximos pasos con fecha, sin cumplir.
 *      Es trabajo concreto que alguien se anotó a sí mismo.
 *   2. **¿A quién dejé de llamar?** — hace cuánto que no se registra nada de un
 *      cliente. Nadie se lo anotó; justamente por eso se pierde.
 *
 * La primera la contesta `clasificarProximoPaso`, la segunda
 * `estadoDeSeguimiento`. Un CRM que sólo tiene la primera se convierte en una
 * lista de tareas, y los clientes que nadie tocó no aparecen nunca.
 *
 * ── LAS FECHAS SE COMPARAN COMO TEXTO ───────────────────────
 *
 * Todo acá son fechas ISO `YYYY-MM-DD` y se comparan con `<` y `>` directo, sin
 * construir un `Date`. No es una astucia: un `new Date("2026-11-12")` se
 * interpreta en UTC y en Argentina da el día anterior a las 21:00, así que la
 * mitad de las tardes el «vence hoy» pasaría a «vencido». El ISO ordena
 * lexicográficamente igual que cronológicamente, que es para lo que se eligió
 * ese formato. `hoy` entra siempre como parámetro —de `hoyEnArgentina()`— y
 * nunca se lee el reloj acá adentro, para que los tests puedan fijar el día.
 */

/** En qué situación está un próximo paso respecto de hoy. */
export type EstadoDelPaso = "cumplido" | "vencido" | "hoy" | "proximo";

/**
 * Hace cuánto que no se registra nada de un cliente.
 *
 * ── LOS DOS CORTES SON UN SUPUESTO, Y ESTO ES LO ÚNICO QUE LOS DICE ──
 *
 * No salen de ningún histórico: **todavía no hay histórico**. Son el supuesto
 * de que a un cliente se lo toca una vez al mes y que dos meses sin hablar ya
 * es haberlo perdido de vista. Viven acá, en un solo lugar y con nombre, para
 * que el día que alguien mire los datos de verdad se cambien en una línea en
 * vez de buscarlos repartidos en tres pantallas.
 *
 * Mientras sean un supuesto, el semáforo **no manda notificaciones**: señala en
 * la pantalla de quien entra a mirar. Un corte inventado que le llega al
 * teléfono a alguien todas las mañanas es exactamente lo que termina con la
 * gente apagando las notificaciones (ver el spec de avisos al instante).
 */
export const DIAS_AL_DIA = 30;
export const DIAS_A_DESTIEMPO = 60;

/** El semáforo de un cliente. `nunca` no es `sin_contacto`: ver abajo. */
export type EstadoDeSeguimiento = "al_dia" | "a_destiempo" | "sin_contacto" | "nunca";

/**
 * El semáforo de un cliente, a partir de la fecha de su última actividad.
 *
 * **`nunca` y `sin_contacto` son dos cosas distintas a propósito.** Un cliente
 * cargado ayer y todavía sin ninguna actividad no está abandonado: está recién
 * entrado, y mostrarlo en rojo junto a los que hace tres meses que nadie llama
 * haría que el rojo deje de querer decir algo. Lo que hay que hacer con cada
 * uno también es distinto — a uno hay que llamarlo por primera vez, al otro hay
 * que explicar qué pasó.
 */
export function estadoDeSeguimiento(
  ultimaActividad: string | null | undefined,
  hoy: string
): EstadoDeSeguimiento {
  if (!ultimaActividad) return "nunca";
  if (ultimaActividad >= sumarDias(hoy, -DIAS_AL_DIA)) return "al_dia";
  if (ultimaActividad >= sumarDias(hoy, -DIAS_A_DESTIEMPO)) return "a_destiempo";
  return "sin_contacto";
}

/** Cómo se lee cada estado del semáforo, y de qué color. */
export const SEMAFORO: Record<EstadoDeSeguimiento, { nombre: string; color: string }> = {
  al_dia: { nombre: "Al día", color: "#15803D" },
  a_destiempo: { nombre: "A destiempo", color: "#B45309" },
  sin_contacto: { nombre: "Sin contacto", color: "#B91C1C" },
  nunca: { nombre: "Sin actividad", color: "#64748B" },
};

/**
 * En qué situación está un próximo paso.
 *
 * **Cumplido gana sobre vencido**, aunque se haya cumplido tarde: lo que
 * importa es que ya no hay nada que hacer. Un paso cumplido con tres días de
 * atraso sigue estando hecho, y dejarlo en rojo haría que la lista de vencidos
 * crezca para siempre con trabajo terminado.
 */
export function clasificarProximoPaso(
  fecha: string | null | undefined,
  cumplidoEl: string | null | undefined,
  hoy: string
): EstadoDelPaso | null {
  if (!fecha) return null;
  if (cumplidoEl) return "cumplido";
  if (fecha < hoy) return "vencido";
  if (fecha === hoy) return "hoy";
  return "proximo";
}

/** Lo mínimo que hace falta de una actividad para clasificar su próximo paso. */
export interface ActividadConPaso {
  proximo_paso: string | null;
  proximo_paso_el: string | null;
  cumplido_el: string | null;
}

export interface ResumenDePasos {
  vencidos: number;
  hoy: number;
  /** Los que vencen dentro de la ventana, sin contar hoy. */
  proximos: number;
}

/**
 * Cuántos pasos pendientes hay en cada situación.
 *
 * **`proximos` tiene ventana y `vencidos` no**, y la asimetría es deliberada:
 * lo vencido es todo lo vencido —esconder lo de hace dos meses es cómo se
 * pierde—, mientras que lo que viene recortado a una semana es lo que entra en
 * la cabeza de alguien al empezar el día. Un «faltan 40 cosas» que incluye algo
 * de marzo no ayuda a decidir qué hacer ahora.
 */
export function resumirPasos(
  actividades: ActividadConPaso[],
  hoy: string,
  ventanaEnDias = 7
): ResumenDePasos {
  const hasta = sumarDias(hoy, ventanaEnDias);
  const resumen: ResumenDePasos = { vencidos: 0, hoy: 0, proximos: 0 };

  for (const a of actividades) {
    const estado = clasificarProximoPaso(a.proximo_paso_el, a.cumplido_el, hoy);
    if (estado === "vencido") resumen.vencidos += 1;
    else if (estado === "hoy") resumen.hoy += 1;
    else if (estado === "proximo" && a.proximo_paso_el! <= hasta) resumen.proximos += 1;
  }

  return resumen;
}

/**
 * Ordena los pasos pendientes como se trabajan: lo más vencido primero.
 *
 * Los cumplidos y los que no tienen fecha quedan afuera: esta lista es lo que
 * hay que hacer, no el historial.
 */
export function pasosPendientes<T extends ActividadConPaso>(actividades: T[], hoy: string): T[] {
  return actividades
    .filter((a) => {
      const estado = clasificarProximoPaso(a.proximo_paso_el, a.cumplido_el, hoy);
      return estado === "vencido" || estado === "hoy" || estado === "proximo";
    })
    .sort((a, b) => (a.proximo_paso_el ?? "").localeCompare(b.proximo_paso_el ?? ""));
}

/**
 * La fecha de la última actividad de cada cliente.
 *
 * Se arma acá, en memoria, y **no se guarda en una columna**: una
 * `ultima_actividad_el` sería una segunda verdad que se desincroniza en cuanto
 * alguien corrija la fecha de una actividad vieja, y nada avisaría. Ver el
 * encabezado de la migración.
 */
export function ultimaActividadPorCliente(
  actividades: { cliente_id: string; fecha: string }[]
): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const a of actividades) {
    const previa = mapa.get(a.cliente_id);
    if (!previa || a.fecha > previa) mapa.set(a.cliente_id, a.fecha);
  }
  return mapa;
}
