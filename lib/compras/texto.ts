/**
 * Normalización de textos que vienen de la planilla.
 *
 * Los encabezados y los valores llegan con acentos, grados, puntos y espacios
 * de más según quién los escribió. Comparar sin normalizar es la fuente más
 * común de "esa columna no existe" cuando existe.
 */
export const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toUpperCase().replace(/[°º.]/g, "").replace(/\s+/g, " ");
