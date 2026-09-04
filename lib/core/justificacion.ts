/**
 * Cuándo un texto libre explica algo, y cuándo es una forma de no contestar.
 *
 * Vive en el núcleo porque la pregunta es la misma en Compras y en
 * Mantenimiento: denegar un RI y denegar una OS le cierran la puerta a otra
 * persona, y en los dos casos hace falta decirle por qué.
 *
 * El problema de exigir "algo escrito" es que un punto satisface a un `.trim()`
 * sin explicar nada. Y el problema de exigir muchos caracteres es el opuesto:
 * "Duplicado" son 9 letras y es un motivo completo. Así que lo que se filtra no
 * es la longitud sino la no-respuesta.
 */

/** Cuántos caracteres, ya normalizado, para que valga la pena leerlo. */
const MINIMO = 4;

/**
 * Las formas de contestar sin contestar.
 *
 * Sólo cuentan cuando son **todo** el texto: "no" no dice nada, pero "no
 * corresponde al área" sí. Por eso se compara el texto entero y no se busca
 * dentro.
 */
const NO_RESPUESTAS = new Set([
  "no", "na", "n/a", "nada", "ninguno", "ninguna", "ningun",
  "sin motivo", "sin razon", "x", "xx", "asd", "test", "prueba",
]);

/**
 * El texto listo para comparar: sin acentos, sin mayúsculas y con los espacios
 * colapsados. Es la misma normalización que usa el resto del sistema, y por la
 * misma razón: la misma palabra escrita de dos formas es la misma palabra.
 */
const clave = (v: unknown): string =>
  String(v ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Si ese texto sirve como justificación.
 *
 * Pide tres cosas: que llegue al mínimo, que tenga alguna letra —así "1234" y
 * "..." no pasan— y que no sea una no-respuesta conocida.
 */
export function justificacionQueExplica(texto: unknown): boolean {
  const k = clave(texto);
  if (k.length < MINIMO) return false;
  if (!/[a-z]/.test(k)) return false;
  return !NO_RESPUESTAS.has(k);
}
