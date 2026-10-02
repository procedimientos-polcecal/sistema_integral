/**
 * Normalización de texto para comparar.
 *
 * Nació para los encabezados de las planillas, que llegan con acentos, grados,
 * puntos y espacios de más según quién los escribió: comparar sin normalizar es
 * la fuente más común de "esa columna no existe" cuando existe.
 *
 * Vive acá desde que la necesitó algo que no es de Compras: el buscador de los
 * desplegables, que lo usan los diez módulos. `lib/compras/texto.ts` la
 * reexporta para no tocar los imports que ya existían.
 */
export const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toUpperCase().replace(/[°º.]/g, "").replace(/\s+/g, " ");
