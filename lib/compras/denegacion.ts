import { justificacionQueExplica } from "@/lib/core/justificacion";

/**
 * Denegar un requerimiento tiene que decir por qué.
 *
 * Es la misma razón que la de la devolución a comparativa —ver
 * `devolucion.ts`—, sólo que peor: devolver le manda trabajo a otra persona,
 * denegar le cierra la puerta. Quien pidió algo se queda sin saber si le falta
 * una cotización, si estaba duplicado, si no había plata o si se resuelve con lo
 * que hay en el pañol. Sin el motivo, el pedido vuelve a entrar igual la semana
 * siguiente.
 *
 * El campo `motivo_rechazo` existe desde el principio y estaba 100% vacío: los
 * 71 RI denegados del histórico entraron por la sincronización de la planilla,
 * que no tiene columna de motivo. Esta regla vale para lo que se deniega dentro
 * del sistema; lo que llega de la planilla sigue entrando sin explicación,
 * porque no hay de dónde sacarla.
 */

/** Lo que el PATCH está poniendo. Sólo interesan estos tres campos. */
export interface CambiosDeDenegacion {
  estado_aprobacion?: unknown;
  estado_compra?: unknown;
  motivo_rechazo?: unknown;
  [otros: string]: unknown;
}

/**
 * Si el cambio deniega el requerimiento.
 *
 * Se mira lo que el cambio **pone**, no el estado en el que está: un PATCH que
 * toca el proveedor de un RI ya denegado no tiene por qué volver a explicarlo.
 *
 * Cuenta por las dos ramas. Denegar por la de compra no es el camino que ofrece
 * la pantalla —la ficha filtra DENEGADO del desplegable— pero la API lo acepta,
 * y una regla que se esquiva cambiando de campo no es una regla.
 */
export function esDenegacion(cambios: CambiosDeDenegacion): boolean {
  return cambios.estado_aprobacion === "DENEGADA" || cambios.estado_compra === "DENEGADO";
}

/** Si a esta denegación le falta el motivo que la explique. */
export function faltaLaJustificacion(cambios: CambiosDeDenegacion): boolean {
  if (!esDenegacion(cambios)) return false;
  return !justificacionQueExplica(cambios.motivo_rechazo);
}

/**
 * Qué se le dice a quien intentó denegar sin explicar.
 *
 * Vive acá y no en la ruta para que el mensaje sea uno solo: la ficha lo muestra
 * y la API lo devuelve, y no puede haber dos versiones de la misma regla dichas
 * de dos maneras.
 */
export const POR_QUE_HACE_FALTA =
  "Para denegar hay que decir por qué: quien lo pidió necesita saber si le falta " +
  "una cotización, si estaba duplicado o si se resuelve con lo que ya hay. " +
  "Un guión o un «no» no alcanzan.";
