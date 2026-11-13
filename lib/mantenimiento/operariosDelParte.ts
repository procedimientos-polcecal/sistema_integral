/**
 * Cómo se ofrece la gente del taller al armar una hoja del parte diario.
 *
 * DOS VOCABULARIOS DE TURNO QUE NO SON EL MISMO
 *
 * El parte diario usa el de **Producción** —`4_12` y `12_20`, los dos que el
 * papel trae preimpresos— y el taller usa el suyo, que tiene **tres**:
 * `4-12`, `8-16` y `12-20`. Son los mismos números de reloj escritos distinto, y
 * el `8-16` del electricista no tiene hoja propia. La traducción está acá, en
 * una función con nombre, y no desparramada en la pantalla: dos vocabularios
 * sin un puente explícito ya hicieron que una OT creada desde la app dejara de
 * aparecer al filtrar.
 *
 * EL TURNO SUGIERE, NO FILTRA
 *
 * Se preguntó y se confirmó: en el papel, el electricista de 8 a 16 **puede
 * figurar** en cualquiera de las dos hojas. Así que el turno elegido decide
 * **el orden**, no quién puede estar. Por eso hay dos listas y no una lista
 * recortada: los del turno arriba, el resto abajo y a mano.
 *
 * Esconder al de 8 a 16 sería el error caro: nadie lo buscaría en una lista que
 * no lo tiene, y terminaría escribiéndose a mano afuera del sistema, que es de
 * donde esto viene.
 */

/** Los turnos del parte: los dos del papel más el día entero. */
export const TURNOS_DEL_PARTE = ["4_12", "12_20", "todo_el_dia"] as const;
export type TurnoDelParte = (typeof TURNOS_DEL_PARTE)[number];

/** El turno del taller, tal como lo nombra `lib/mantenimiento/programacion.ts`. */
export type TurnoDelTaller = "4-12" | "8-16" | "12-20";

export interface PersonaParaElParte {
  empleadoId: string;
  nombre: string;
  /** Su turno esa semana, o null si no se sabe (sin referencia cargada). */
  turno: TurnoDelTaller | null;
}

/**
 * El turno del taller que corresponde a una hoja del parte, o `null`.
 *
 * `todo_el_dia` devuelve null a propósito: no es un turno, es la ausencia de
 * turno, y por eso con él no hay dos listas.
 */
export function elTurnoDelTaller(turno: TurnoDelParte): TurnoDelTaller | null {
  if (turno === "4_12") return "4-12";
  if (turno === "12_20") return "12-20";
  return null;
}

/**
 * Parte la gente en los dos grupos que muestra la pantalla.
 *
 * Con `todo_el_dia` —o cuando nadie tiene turno, que es lo que pasa mientras no
 * haya una semana de referencia cargada— `delTurno` queda vacío y **están todos
 * en `losDemas`**. Lo que no puede pasar es que las dos queden vacías: la
 * pantalla dejaría de servir justo el día que falta la referencia.
 *
 * Las dos listas van alfabéticas para que el mismo padrón dé siempre el mismo
 * orden, y nadie puede estar en las dos.
 */
export function repartirPorTurno(
  gente: PersonaParaElParte[],
  turno: TurnoDelParte
): { delTurno: PersonaParaElParte[]; losDemas: PersonaParaElParte[] } {
  const delTaller = elTurnoDelTaller(turno);
  const porNombre = (a: PersonaParaElParte, b: PersonaParaElParte) =>
    a.nombre.localeCompare(b.nombre, "es");

  if (delTaller === null) {
    return { delTurno: [], losDemas: [...gente].sort(porNombre) };
  }

  return {
    delTurno: gente.filter((p) => p.turno === delTaller).sort(porNombre),
    losDemas: gente.filter((p) => p.turno !== delTaller).sort(porNombre),
  };
}
