/**
 * PostgREST corta cualquier `select` en 1000 filas (`db-max-rows`) y NO avisa:
 * devuelve las primeras 1000 como si fueran todas, sin error. En este módulo
 * eso muerde seguido, porque `calculos_diarios` tiene una fila por empleado y
 * por día: con ~70 empleados, dos semanas ya pasan las 1000, y un año son más
 * de 14.000. Cualquier pantalla que sume sobre esas filas sin paginar muestra
 * un número que parece bien y está mal.
 *
 * `traerPaginado` recorre el resultado completo con `.range()`. Para que las
 * páginas no se solapen ni saltee filas, la consulta necesita un orden
 * estable: se ordena por `id` (clave primaria) salvo que quien llama ya haya
 * puesto un orden propio.
 */

export const PAGINA = 1000;

/** Lo mínimo que necesitamos de un query builder de supabase-js: poder pedir un rango. */
export interface QueryPaginable<T> {
  range: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

/**
 * Ejecuta la consulta tantas veces como haga falta y devuelve TODAS las filas.
 *
 * `hacerQuery` se llama una vez por página, así que tiene que construir la
 * consulta de cero cada vez (los builders de supabase-js no se pueden reusar
 * después de ejecutarlos).
 */
export async function traerPaginado<T>(hacerQuery: () => QueryPaginable<T>, etiqueta = "consulta"): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await hacerQuery().range(desde, desde + PAGINA - 1);
    if (error) throw new Error(`${etiqueta}: ${error.message}`);
    const pagina = data ?? [];
    filas.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return filas;
}
