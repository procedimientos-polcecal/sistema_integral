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
 * Como `traerTodo`, pero para una tabla grande que se trae entera a
 * menudo: pide el total exacto en el mismo viaje que la primera página
 * (`{ count: "exact" }` — PostgREST lo devuelve en el header `Content-Range`
 * sin costo extra) y pide el resto de las páginas juntas, en paralelo, en
 * vez de una atrás de la otra.
 *
 * `cantera_pesadas` (7623 filas al 22/09/2026, y crece: son 8 páginas) mide
 * ~2s en serie porque cada página espera a la anterior; en paralelo, todas
 * menos la primera tardan lo mismo que la más lenta — la diferencia real
 * entre "cambiar de mes en Destape tarda" y no.
 *
 * No sirve para todo `traerTodo`: exige que el callback pida `count: "exact"`
 * en su `.select()`, así que sólo tiene sentido en los pocos lugares donde
 * el tamaño de la tabla lo justifica.
 *
 * Uso:
 *   const filas = await traerTodoEnParalelo((desde, hasta) =>
 *     db.from("cantera_pesadas").select("id, toneladas", { count: "exact" }).range(desde, hasta)
 *   );
 */
export async function traerTodoEnParalelo<T>(
  pagina: (desde: number, hasta: number) => PromiseLike<{
    data: T[] | null;
    count?: number | null;
    error: { message: string } | null;
  }>,
  tamano = 1000
): Promise<T[]> {
  const primera = await pagina(0, tamano - 1);
  if (primera.error) throw new Error(primera.error.message);
  const lote0 = primera.data ?? [];

  const total = primera.count ?? null;
  // Sin `count` (el caller no lo pidió) o ya entró todo en la primera
  // página: no hay nada más que pedir.
  if (total === null || lote0.length < tamano) return lote0;

  const totalPaginas = Math.ceil(total / tamano);
  if (totalPaginas <= 1) return lote0;

  const pedidosRestantes = Array.from({ length: totalPaginas - 1 }, (_, i) => {
    const numeroDePagina = i + 1;
    const desde = numeroDePagina * tamano;
    return pagina(desde, desde + tamano - 1);
  });
  const resultados = await Promise.all(pedidosRestantes);

  const todo = lote0.slice();
  for (const { data, error } of resultados) {
    if (error) throw new Error(error.message);
    todo.push(...(data ?? []));
  }
  return todo;
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
