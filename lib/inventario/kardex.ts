/**
 * Lo que el kardex lee de una fila que trae el artículo embebido.
 *
 * POR QUÉ ESTO ES UNA FUNCIÓN Y NO UN `m.articulo.descripcion` EN LA PANTALLA
 *
 * Un embed de PostgREST tiene **dos formas posibles**: devuelve un objeto
 * cuando puede probar que la relación es de uno a uno, y un arreglo cuando no.
 * Acá el runtime devuelve un objeto —`articulo_id` es una clave foránea común
 * y corriente, y medido el 23/11/2026 sobre las últimas 1.000 filas llegan las
 * 1.000 descripciones—, pero **el tipo que infiere el cliente de Supabase es
 * un arreglo**, así que escribirlo a mano obliga a un `as` que miente sobre
 * una de las dos puntas.
 *
 * Es el mismo problema que `lib/rrhh/valorHora.ts` resolvió para el valor hora
 * y la misma solución: las dos formas se aceptan en un solo lugar, con test.
 * La diferencia es qué se rompe si cambia la forma. Allá era un `NaN` que
 * llegaba hasta un recibo; acá es más callado todavía —la columna «Artículo»
 * se queda con el código y sin nombre—, que es exactamente lo que esta
 * pantalla acaba de dejar de hacer.
 *
 * Devuelve `null` y no `""` cuando no hay nada: la pantalla decide qué dibujar
 * con lo que falta, que no es lo mismo en una tabla que en una tarjeta.
 */

/** Lo que llega en `articulo:inventario_articulos(descripcion)`. */
export type EmbedDeArticulo =
  | { descripcion?: string | null }
  | { descripcion?: string | null }[]
  | null
  | undefined;

/** La fila del kardex, recortada a lo único que esta función mira. */
export interface ConArticulo {
  articulo?: EmbedDeArticulo;
}

export function descripcionDelArticulo(fila: ConArticulo | null | undefined): string | null {
  const embebido = fila?.articulo;
  const uno = Array.isArray(embebido) ? embebido[0] : embebido;
  const texto = String(uno?.descripcion ?? "").trim();
  return texto || null;
}
