/**
 * El juego de tamices de un producto, normalizado.
 *
 * Vive en una función y no adentro de la ruta porque es lo que decide el orden
 * en que se dibujan las filas de la pantalla de carga, y ése es el orden físico
 * del juego de tamices: malla creciente es abertura decreciente. Un juego
 * cargado como `100, 50, 50, 200` tiene que quedar `50, 100, 200` siempre, no
 * según cómo lo haya tipeado quien lo configuró.
 *
 * No se comprueba en la base: hacerlo necesita `unnest` y un CHECK de Postgres
 * no admite subconsultas. Acá, entonces, o en ningún lado.
 */
export function normalizarMallas(crudas: unknown): { mallas: number[]; problema?: string } {
  if (!Array.isArray(crudas)) return { mallas: [] };

  const limpias: number[] = [];
  for (const cruda of crudas) {
    const n = Number(cruda);
    if (!Number.isInteger(n) || n <= 0) {
      return { mallas: [], problema: `"${cruda}" no es un número de malla.` };
    }
    if (!limpias.includes(n)) limpias.push(n);
  }

  return { mallas: limpias.sort((a, b) => a - b) };
}

/**
 * Las mallas tipeadas en un campo de texto: `"50, 100, 200"`.
 *
 * Acepta coma, punto y coma o espacios, porque quien configura un producto no
 * tiene por qué saber cuál esperábamos.
 */
export function mallasDesdeTexto(texto: string): { mallas: number[]; problema?: string } {
  const partes = texto
    .split(/[,;\s]+/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  return normalizarMallas(partes);
}
