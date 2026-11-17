/**
 * Qué empleados se muestran al elegir un turno.
 *
 * ## El bug que arregla
 *
 * El selector de turno de Hoy y de Semana filtraba los **registros** pero
 * nunca la **lista de personas**. La asistencia, el plan y las hojas de ruta
 * se piden a la API con `turnoId` y vienen bien filtrados; pero los nombres
 * salen de `/api/remises/empleados`, que no sabe nada de turnos y devuelve los
 * 69 empleados activos siempre. Así que cambiar de turno no cambiaba la lista:
 * sólo cambiaban las tildes verdes de quién está marcado. Con 5 turnos y 69
 * nombres, encontrar a los 5 de Pasantes era recorrer la lista entera.
 *
 * Pasaba en tres listas con el mismo origen: la de Asistencia en Hoy, y las de
 * Ida y Vuelta en Semana.
 *
 * ## Por qué no alcanza con filtrar por `turno_default_id`
 *
 * Porque el turno default es una costumbre, no una regla. Medido el
 * 05/11/2026 sobre los datos de producción: de 501 registros de asistencia,
 * **150 —el 30 %, repartidos en 22 fechas— son de gente marcada en un turno
 * que no es su default**. Filtrar sólo por el default los sacaría de la
 * pantalla, y entonces el registro queda vivo en la base y fuera del alcance
 * de quien lo cargó: no se lo ve y no se lo puede desmarcar. Sería un bug peor
 * que el que esto arregla, y de los que no avisan.
 *
 * Por eso la regla tiene dos mitades: **los del turno, más los que ya están
 * marcados en este turno**. Nadie que esté marcado puede volverse invisible.
 *
 * ## Los que no tienen datos de Remises
 *
 * De los 69 empleados activos, **44 no tienen fila en
 * `remises_empleados_datos`**: ni dirección, ni coordenadas, ni turno. No
 * pueden entrar en ninguna ruta, y hoy aparecen en los cinco turnos ocupando
 * dos tercios de la lista. Quedan afuera, pero **se cuentan** para poder
 * decirlo en pantalla: hacer desaparecer a 44 personas sin explicación es la
 * clase de cosa que después nadie entiende. Si a uno de ellos lo marcan igual,
 * la segunda mitad de la regla lo vuelve visible.
 */

export interface EmpleadoParaTurno {
  id: string;
  remises_empleados_datos?:
    | { turno_default_id?: string | null }
    | { turno_default_id?: string | null }[]
    | null;
}

/**
 * El turno habitual de un empleado, o null si no tiene datos de Remises.
 *
 * Resuelve las dos formas del embed de PostgREST —objeto y array—, igual que
 * `valorHoraDe()` en RRHH. Hoy `/api/remises/empleados` lo devuelve como
 * objeto (verificado contra la API real), pero la forma depende de cómo se
 * escriba el `select`, y que cambie no rompe nada visible: simplemente
 * dejaría de encontrar el turno y todos caerían en "sin datos".
 */
export function turnoDefaultDe(empleado: EmpleadoParaTurno): string | null {
  const datos = empleado.remises_empleados_datos;
  if (!datos) return null;
  const fila = Array.isArray(datos) ? datos[0] : datos;
  return fila?.turno_default_id ?? null;
}

export interface RepartoPorTurno<T> {
  /** Los que se muestran: los del turno más los que ya están marcados. */
  visibles: T[];
  /** Cuántos quedaron afuera por no tener datos de Remises cargados. */
  sinDatos: number;
  /** Cuántos quedaron afuera por ser de otro turno y no estar marcados. */
  deOtroTurno: number;
}

/**
 * Reparte los empleados entre los que se muestran para `turnoId` y los que no,
 * conservando el orden en que llegan (la API ya los manda por apellido y
 * nombre).
 *
 * `marcados` son los ids que ya figuran en este turno —presentes en Hoy, o
 * "Va" en Semana—, y entran siempre, sea cual sea su turno default.
 *
 * Sin `turnoId` no hay con qué filtrar y devuelve a todos: es lo que pasa
 * cuando no hay ningún turno activo configurado, y una pantalla vacía ahí no
 * ayudaría a nadie.
 */
export function repartirPorTurno<T extends EmpleadoParaTurno>(
  empleados: T[],
  turnoId: string,
  marcados: ReadonlySet<string>,
): RepartoPorTurno<T> {
  if (!turnoId) return { visibles: [...empleados], sinDatos: 0, deOtroTurno: 0 };

  const visibles: T[] = [];
  let sinDatos = 0;
  let deOtroTurno = 0;

  for (const empleado of empleados) {
    const suTurno = turnoDefaultDe(empleado);
    if (suTurno === turnoId || marcados.has(empleado.id)) {
      visibles.push(empleado);
    } else if (suTurno === null) {
      sinDatos++;
    } else {
      deOtroTurno++;
    }
  }

  return { visibles, sinDatos, deOtroTurno };
}
