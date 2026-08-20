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
