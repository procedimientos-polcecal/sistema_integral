/**
 * El valor hora de un empleado, leído del embed de `rrhh_empleados_datos`.
 *
 * POR QUÉ EXISTE ESTA FUNCIÓN Y NO SE ESCRIBE A MANO EN CADA RUTA
 *
 * El valor hora dejó de ser una columna de `empleados` y pasó a
 * `rrhh_empleados_datos` (migración 20260922101405): en `empleados` lo podía
 * leer cualquier usuario autenticado, porque esa tabla es un catálogo del
 * núcleo con la lectura abierta y RLS no sabe tapar una columna sola.
 *
 * El precio de la mudanza es que el número dejó de venir plano y ahora llega
 * anidado en un embed. Y un embed tiene **dos formas posibles**: PostgREST
 * devuelve un objeto cuando puede probar que la relación es de uno a uno —acá
 * lo es, `empleado_id` es a la vez clave primaria y foránea— y un arreglo
 * cuando no. Que hoy devuelva objeto no es algo que convenga escribir cuatro
 * veces en cuatro rutas de plata: el día que un `select` cambie de forma, lo
 * que se rompe es `Number(undefined)` → `NaN`, y un `NaN` multiplicado por
 * horas no explota, se propaga hasta un recibo que dice `$ NaN`.
 *
 * Así que las dos formas se aceptan acá, en un solo lugar, con test.
 *
 * SOBRE DEVOLVER 0 CUANDO NO HAY NADA
 *
 * Es lo mismo que hacía la columna original, que era `not null default 0`, y
 * es deliberado: quien tiene que gritar es la **escritura**, no la lectura. El
 * alta de empleado y la importación de la planilla ahora devuelven error si no
 * pueden guardar el valor hora, que es donde el problema se puede arreglar.
 * Una lectura que tirara una excepción sólo dejaría el tablero en blanco sin
 * decir de quién.
 */

/** Lo que devuelve PostgREST en `rrhh_empleados_datos(valor_hora_normal)`. */
type EmbedDeDatos =
  | { valor_hora_normal?: number | string | null }
  | { valor_hora_normal?: number | string | null }[]
  | null
  | undefined;

export interface ConValorHora {
  rrhh_empleados_datos?: EmbedDeDatos;
}

export function valorHoraDe(fila: ConValorHora | null | undefined): number {
  const datos = fila?.rrhh_empleados_datos;
  const uno = Array.isArray(datos) ? datos[0] : datos;
  const n = Number(uno?.valor_hora_normal);
  return Number.isFinite(n) ? n : 0;
}

/**
 * La fila con el valor hora ya plano, como estaba antes de la mudanza.
 *
 * Existe para que el cálculo de plata que viene después no tenga que saber
 * nada del embed: las rutas del tablero, la planilla general y la generación
 * de liquidaciones aplanan apenas leen y siguen trabajando con
 * `e.valor_hora_normal` como siempre.
 */
export function conValorHoraPlano<T extends ConValorHora>(
  filas: T[] | null | undefined
): (T & { valor_hora_normal: number })[] {
  return (filas ?? []).map((f) => ({ ...f, valor_hora_normal: valorHoraDe(f) }));
}
