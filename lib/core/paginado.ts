/**
 * Trae todas las filas de una consulta, en tandas.
 *
 * PostgREST corta las respuestas en 1000 filas y no avisa: `.limit(3000)`
 * devuelve 1000 igual. Sin paginar, cualquier cuenta o control sobre una tabla
 * que pase ese tamaño queda mal en silencio, que es la peor forma de estar mal.
 *
 * Uso:
 *   const filas = await traerTodo((desde, hasta) =>
 *     db.from("compras_requerimientos").select("nro_ri, editado_en_app").range(desde, hasta)
 *   );
 */
export async function traerTodo<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
  tamano = 1000
): Promise<T[]> {
  const todo: T[] = [];

  for (let desde = 0; ; desde += tamano) {
    const { data, error } = await pagina(desde, desde + tamano - 1);
    if (error) throw new Error(error.message);

    const lote = data ?? [];
    todo.push(...lote);

    // Una tanda incompleta significa que no hay más.
    if (lote.length < tamano) return todo;
  }
}

/**
 * El número de página que pidió el navegador, siempre usable.
 *
 * `Number(searchParams.get("page") ?? 1)` parece inofensivo y no lo es:
 * `?page=abc` da `NaN`, `?page=0` da 0, y los dos terminan en un `.range()`
 * inválido —`Range: NaN-NaN`, o `-50` a `-1`— que PostgREST rechaza. El handler
 * no lo atrapa, así que el navegador recibe un 500 con stack en vez de la
 * primera página.
 *
 * No devuelve error: una URL con la página mal escrita quiere ver el listado,
 * no un cartel. Se cae a la 1, que es lo que esperaría cualquiera.
 */
export function paginaPedida(valor: string | null | undefined): number {
  const n = Number(valor ?? 1);
  if (!isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}
