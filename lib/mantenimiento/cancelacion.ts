/**
 * La regla de cancelar una orden de trabajo.
 *
 * Vive acá y no dentro de la ruta por una razón sola: es la lógica que decide, y
 * la que está en un route handler no se puede probar en este repo (las rutas no
 * tienen tests). Sacarla a una función pura es lo que permite fijar con casos
 * que **no se cancela sin decir por qué** — que es todo el sentido del estado
 * `CANCELADA`: «esta orden no se va a hacer» sin un motivo escrito es una OT que
 * desaparece del tablero sin que nadie sepa qué pasó.
 *
 * El orden de los chequeos importa y los tests lo fijan (con el estado malo y el
 * texto malo a la vez, se oye primero el estado):
 *
 * 1. Una justificación que llega con un estado que no es cancelación es un error
 *    del que llama, y no se traga: alguien mandó un texto creyendo que se
 *    guardaba, y callarlo es perderlo sin aviso.
 * 2. Después, si el estado actual deja cancelar.
 * 3. Después, la fecha de cierre, que es la misma contradicción por otra puerta.
 * 4. Recién ahí, `validarNota`, que ya sabe de vacíos y del tope de largo.
 */

import { validarNota } from "@/lib/mantenimiento/notas";

export const ESTADO_CANCELADA = "CANCELADA";

/**
 * Si el estado que se pide es una cancelación.
 *
 * Compara exacto, sin `trim` ni mayúsculas, a diferencia de `actual` más abajo:
 * lo pedido es lo que se va a guardar en la columna y en la celda M, así que
 * tiene que ser el valor del vocabulario tal cual. Un «cancelada» en minúscula
 * no es un sinónimo que haya que aceptar: es un cliente que manda otra cosa, y
 * la ruta lo rechaza igual con `esEstadoDeOT`.
 */
export function esCancelacion(estado: unknown): boolean {
  return estado === ESTADO_CANCELADA;
}

/**
 * Desde dónde se puede cancelar: las tres abiertas, y la propia cancelada (que
 * se vuelve a justificar sin cambiar de estado).
 *
 * `REALIZADO` queda afuera a propósito. Una orden realizada tiene
 * `fecha_cierre`, y `estadoSegunElCierre()` dice que la fecha manda: cancelarla
 * crearía una fila que se contradice a sí misma. Medido: hoy hay 0 filas en ese
 * caso, así que prohibirlo no le saca nada a nadie.
 *
 * Tiene un gemelo que no se unifica: `ESTA_PENDIENTE` de `prioridad.ts`, los
 * mismos tres estados en otro orden. Una responde «qué órdenes siguen
 * pendientes» y ésta «desde qué estados se puede cancelar»: dos preguntas que
 * hoy comparten respuesta. Un estado nuevo se decide en cada una por separado.
 */
export const SE_CANCELA_DESDE: readonly string[] = ["POR_HACER", "EN_PROCESO", "ATRASADO"];

export type ResultadoDeCancelar =
  | { ok: true; texto: string }
  | { ok: false; error: string };

/** Si vino algo que valga la pena mirar: `""`, solo espacios, null y undefined son «no vino». */
function vino(valor: unknown): boolean {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === "string") return valor.trim() !== "";
  return true;
}

/**
 * Qué impide este cambio de estado por el lado de la cancelación, o el texto de
 * la justificación ya limpio si no hay nada que lo impida.
 *
 * `texto` vale `""` cuando el pedido no es una cancelación y tampoco trae
 * justificación: así quien llama no tiene que distinguir «no vino» de «vino
 * vacía» para decidir si guarda una nota.
 *
 * `fechaCierre` es **la del pedido o la que la orden ya tiene guardada**, y le
 * toca resolver esa cuenta a quien llama, que es el único que tiene las dos. Si
 * mirara sólo la del cuerpo se escaparía el caso vivo: «Parcial» del modal de
 * registrar deja la orden `EN_PROCESO` **con** fecha de cierre, y cancelarla
 * después pasaría —el estado deja y el cuerpo no trae fecha—. El PATCH de
 * `app/api/mantenimiento/ordenes/route.ts` tiene la cuenta y el porqué medido.
 */
export function loQueImpideCancelar(args: {
  estadoPedido: unknown;
  estadoActual: unknown;
  justificacion: unknown;
  fechaCierre?: unknown;
}): ResultadoDeCancelar {
  const { estadoPedido, estadoActual, justificacion, fechaCierre } = args;

  if (!esCancelacion(estadoPedido)) {
    if (vino(justificacion)) {
      return {
        ok: false,
        error:
          `Mandaste una justificación pero el estado pedido no es ${ESTADO_CANCELADA}: ` +
          `no se guardó. La justificación sólo se pide al cancelar.`,
      };
    }
    return { ok: true, texto: "" };
  }

  // `estadoActual` llega como `unknown` porque lo trae quien llama, y esta
  // función es la que decide: normalizar es lo que le permite contestar «en
  // estado desconocido» ante un `null` o un `undefined` en vez de romper o, peor,
  // dejar pasar la cancelación. No es una defensa contra una base sucia —medido
  // el 16/11/2026, las 2.466 filas dicen exactamente una de las cinco palabras
  // del vocabulario—: es que el tipo del parámetro no promete nada.
  const actual = String(estadoActual ?? "").trim().toUpperCase();
  if (actual !== ESTADO_CANCELADA && !SE_CANCELA_DESDE.includes(actual)) {
    return {
      ok: false,
      error:
        actual === "REALIZADO"
          ? "No se puede cancelar una orden realizada: ya tiene fecha de cierre."
          : `No se puede cancelar una orden en estado ${actual || "desconocido"}.`,
    };
  }

  // Una fecha de cierre dice «el trabajo se hizo tal día», y todo el sistema la
  // lee así: `costoEquipo` la usa como la fecha del gasto —`fecha_ejecucion ??
  // fecha_cierre ?? fecha`—, `loQueFaltaParaCerrar` exige horas y un operario en
  // cuanto aparece, y el alta la convierte en REALIZADO con `estadoSegunElCierre`.
  // Una orden cancelada con fecha de cierre mete un trabajo fantasma en el costo
  // por equipo. No se ignora en silencio, venga del cuerpo o de la fila: quien la
  // mandó cree que la guardó, y la que ya estaba sigue ahí después del update.
  if (vino(fechaCierre)) {
    return {
      ok: false,
      error: "Una orden cancelada no lleva fecha de cierre: esa fecha dice que se hizo.",
    };
  }

  // Reusa las reglas de la nota (vacío, tope de largo) en vez de repetirlas.
  return validarNota(justificacion);
}
