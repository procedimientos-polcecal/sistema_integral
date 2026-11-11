/**
 * Cuánto de un texto libre entra en un asunto.
 *
 * Un texto libre es un `<textarea>` sin tope —la descripción de una carga, el
 * cuerpo de un mensaje—, y el asunto es una **cabecera**: un salto de línea ahí
 * es una cabecera partida y dos mil caracteres son un asunto fuera de norma. Es
 * el único campo libre que llega a una.
 *
 * Vivía en `lib/mantenimiento/correoDeLaCarga.ts`, y se sacó a `lib/core/` el
 * día que apareció el segundo constructor de correos (`mensajes.ts`): el mismo
 * problema resuelto dos veces es cómo se separan, y uno de los dos queda sin el
 * arreglo.
 */
export const LARGO_DEL_ASUNTO = 80;

/** Lo que puede ir en una cabecera: una sola línea y acotada. */
export function paraUnAsunto(texto: string): string {
  const unaLinea = texto.replace(/\s+/g, " ").trim();
  return unaLinea.length > LARGO_DEL_ASUNTO ? `${unaLinea.slice(0, LARGO_DEL_ASUNTO - 1)}…` : unaLinea;
}
