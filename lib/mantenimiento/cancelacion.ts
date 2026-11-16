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
 * El orden de los chequeos importa y es el de los tests:
 *
 * 1. Una justificación que llega con un estado que no es cancelación es un error
 *    del que llama, y no se traga: alguien mandó un texto creyendo que se
 *    guardaba, y callarlo es perderlo sin aviso.
 * 2. Después, si el estado actual deja cancelar.
 * 3. Recién ahí, `validarNota`, que ya sabe de vacíos y del tope de largo.
 */

import { validarNota } from "@/lib/mantenimiento/notas";

export const ESTADO_CANCELADA = "CANCELADA";

/** Si el estado que se pide es una cancelación. */
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

  // Una fecha de cierre dice «se hizo tal día»: estadoSegunElCierre la convierte
  // en REALIZADO y costoEquipo la cobra. No se ignora en silencio, porque quien
  // la mandó cree que la guardó.
  if (vino(fechaCierre)) {
    return {
      ok: false,
      error: "Una orden cancelada no lleva fecha de cierre: esa fecha dice que se hizo.",
    };
  }

  // Reusa las reglas de la nota (vacío, tope de largo) en vez de repetirlas.
  return validarNota(justificacion);
}
