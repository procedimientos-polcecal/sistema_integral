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

/**
 * Si un texto responde a lo que se escribió para buscar.
 *
 * Dos cosas que un `includes` pelado no hace:
 *
 * - **Ignora los acentos**, porque nadie los escribe al buscar: `olavarria`
 *   tiene que encontrar `Bolsas Olavarría`.
 * - **Acepta las palabras en cualquier orden.** Quien busca un equipo se acuerda
 *   de dos pedazos del nombre, no de cómo estaban ordenados: `olav bolsas`
 *   encuentra `Bolsas Olavarría` igual que `bolsas olav`.
 *
 * ── POR QUÉ VIVE ACÁ Y NO EN `components/desplegables.ts` ───────────────────
 *
 * Nació ahí, para el buscador de los desplegables. Se mudó cuando la necesitó
 * el buscador de un listado —el de órdenes de servicio—, que es `lib/` y no
 * puede importar de `components/` sin dar vuelta las capas. Dejarla duplicada
 * era volver a tener dos buscadores que buscan distinto y ninguna respuesta a
 * "por qué éste encuentra y aquél no": es la misma razón por la que `norm` ya
 * está acá. `components/desplegables.ts` la reexporta para no tocar los
 * imports que ya existían.
 */
export function coincide(texto: string, consulta: string): boolean {
  const q = norm(consulta);
  if (!q) return true;
  const donde = norm(texto);
  return q.split(" ").every((pedazo) => donde.includes(pedazo));
}
