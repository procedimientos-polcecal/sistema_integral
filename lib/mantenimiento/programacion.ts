/**
 * La rotación semanal del taller de mantenimiento: dos ciclos con períodos
 * distintos, que juntos se repiten recién a las seis semanas.
 *
 * - Los grupos A y B (mecánicos y lubricador) alternan entre 4-12 y 12-20 cada
 *   semana, y nunca van a 8-16. Período 2.
 * - Los tres electricistas rotan, uno por turno, avanzando un turno por semana
 *   por los tres. Período 3.
 *
 * Funciones puras, sin base ni red: el cálculo vive acá para poder probarlo.
 */

export type Turno = "4-12" | "8-16" | "12-20";
export type Oficio = "mecanico" | "electricista" | "lubricador";
export type Grupo = "A" | "B";

export interface Referencia {
  lunes: string;
  grupoEn4a12: Grupo;
  electricistas: Record<Turno, string>; // empleado_id
}

/** Orden de los turnos para el ciclo de los grupos: sólo 4-12 y 12-20. */
const ORDEN_GRUPOS: readonly Turno[] = ["4-12", "12-20"];

/** Orden de los turnos para el ciclo de los electricistas: los tres. */
const ORDEN_ELECTRICISTAS: readonly Turno[] = ["4-12", "8-16", "12-20"];

/**
 * Cuántas semanas hay de `lunesRef` a `lunes`, con signo: negativo si `lunes`
 * es anterior. Ambos son lunes "YYYY-MM-DD".
 */
export function semanasDesdeLaReferencia(lunesRef: string, lunes: string): number {
  const dias = (fecha: string) => {
    const [a, m, d] = fecha.split("-").map(Number);
    return Date.UTC(a, m - 1, d) / 86_400_000;
  };
  return Math.round((dias(lunes) - dias(lunesRef)) / 7);
}

/** Módulo que no se va a negativo: el `%` de JavaScript conserva el signo del operando. */
function modulo(n: number, periodo: number): number {
  return ((n % periodo) + periodo) % periodo;
}

/** El turno que tiene el grupo `grupo` en la semana que empieza el lunes `lunes`. */
export function turnoDelGrupo(ref: Referencia, lunes: string, grupo: Grupo): Turno {
  const semanas = semanasDesdeLaReferencia(ref.lunes, lunes);
  // En la semana de referencia el grupo que está en 4-12 ocupa el índice 0 y el otro el 1.
  const indiceBase = grupo === ref.grupoEn4a12 ? 0 : 1;
  return ORDEN_GRUPOS[modulo(indiceBase + semanas, ORDEN_GRUPOS.length)];
}

/**
 * El turno del electricista `empleadoId` en la semana que empieza el lunes
 * `lunes`, o null si no es uno de los tres de la referencia.
 */
export function turnoDelElectricista(
  ref: Referencia,
  lunes: string,
  empleadoId: string,
): Turno | null {
  const turnoDeRef = (Object.keys(ref.electricistas) as Turno[]).find(
    (t) => ref.electricistas[t] === empleadoId,
  );
  if (!turnoDeRef) return null;
  const semanas = semanasDesdeLaReferencia(ref.lunes, lunes);
  const indiceBase = ORDEN_ELECTRICISTAS.indexOf(turnoDeRef);
  return ORDEN_ELECTRICISTAS[modulo(indiceBase + semanas, ORDEN_ELECTRICISTAS.length)];
}
