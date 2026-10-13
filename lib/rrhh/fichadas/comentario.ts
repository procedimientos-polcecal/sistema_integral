/** Largo máximo del comentario de una marcación corregida. */
export const MAX_COMENTARIO = 300;

/**
 * El comentario que acompaña a una marcación corregida a mano, normalizado.
 *
 * `undefined` = "no vino": la ruta no toca lo que ya había guardado. Esa
 * diferencia importa: el modal manda un PUT por cada fila aunque no se haya
 * tocado, y una pantalla que no trajo el comentario no puede borrar el que
 * está en la base por mandar un texto vacío.
 *
 * Vacío o sólo espacios = `null` (sin comentario).
 */
export function normalizarComentario(
  valor: unknown
): { ok: true; valor: string | null | undefined } | { ok: false; error: string } {
  if (valor === undefined) return { ok: true, valor: undefined };
  if (valor === null) return { ok: true, valor: null };
  if (typeof valor !== "string") return { ok: false, error: "El comentario tiene que ser un texto" };
  const texto = valor.trim();
  if (texto.length > MAX_COMENTARIO) {
    return { ok: false, error: `El comentario no puede pasar de ${MAX_COMENTARIO} caracteres (tiene ${texto.length})` };
  }
  return { ok: true, valor: texto === "" ? null : texto };
}
