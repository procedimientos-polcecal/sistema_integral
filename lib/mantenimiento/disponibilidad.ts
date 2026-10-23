/**
 * Quién puede tapar un hueco de la programación del taller: el cruce con las
 * ausencias y la lista de candidatos.
 *
 * Funciones puras, sin base ni red. Las fechas son ISO "YYYY-MM-DD", así que se
 * comparan como strings: no se parsean a `Date`.
 */

import type { Grupo, Oficio, Turno } from "./programacion";

/** Una persona del taller con la vigencia de su pertenencia al padrón. */
export interface PersonaDelTaller {
  empleadoId: string;
  oficio: Oficio;
  grupo: Grupo | null;
  /** Primer día en que es del taller (inclusive). */
  desde: string;
  /** Último día en que es del taller (inclusive), o null si sigue. */
  hasta: string | null;
}

/** Una fila de `ausencias`, tal como la devuelve la base. */
export interface AusenciaCruda {
  empleado_id: string;
  fecha_desde: string;
  fecha_hasta: string;
  tipo: string;
}

/** Quién está en qué turno en qué día, ya sea por el ciclo o movido a mano. */
export interface Asignacion {
  empleadoId: string;
  dia: string;
  turno: Turno;
  /** True si lo movió el jefe de taller y no el ciclo. Cuenta igual. */
  pisada: boolean;
}

/**
 * Los tipos de ausencia que NO dejan un hueco. Hoy es sólo la tardanza: el que
 * llega tarde viene a trabajar, y pintarlo como hueco es el anti-objetivo del
 * diseño. Los otros once tipos del enum significan que la persona no está, y al
 * taller no le importa si es justificada o no.
 */
export const TIPOS_QUE_NO_SON_FALTA: readonly string[] = ["TARDANZA"];

/** Si la persona pertenece al taller el día `dia`. Los dos extremos son inclusivos. */
export function estaVigente(persona: PersonaDelTaller, dia: string): boolean {
  return persona.desde <= dia && (persona.hasta === null || dia <= persona.hasta);
}

/**
 * Si `empleadoId` no está el día `dia`. Se compara día por día: una ausencia que
 * arranca el jueves no vacía el lunes de esa semana.
 */
export function estaAusente(
  ausencias: AusenciaCruda[],
  empleadoId: string,
  dia: string,
): boolean {
  return ausencias.some(
    (a) =>
      a.empleado_id === empleadoId &&
      !TIPOS_QUE_NO_SON_FALTA.includes(a.tipo) &&
      a.fecha_desde <= dia &&
      dia <= a.fecha_hasta,
  );
}

/**
 * Los empleados que pueden tapar un hueco: mismo oficio, vigentes ese día, no
 * ausentes y que no estén ya en ese turno ese día (sea por el ciclo o porque
 * ya los movieron: sugerirlo dos veces lo pondría en dos lugares a la vez).
 *
 * No mira si mover a alguien deja corto a su propio turno: se pidió así y el
 * jefe de taller decide.
 */
export function candidatosParaElHueco(
  asignaciones: Asignacion[],
  ausentes: (empleadoId: string, dia: string) => boolean,
  padron: PersonaDelTaller[],
  hueco: { dia: string; turno: Turno; oficio: Oficio },
): string[] {
  const yaEnEseTurno = new Set(
    asignaciones
      .filter((a) => a.dia === hueco.dia && a.turno === hueco.turno)
      .map((a) => a.empleadoId),
  );
  return padron
    .filter(
      (p) =>
        p.oficio === hueco.oficio &&
        estaVigente(p, hueco.dia) &&
        !ausentes(p.empleadoId, hueco.dia) &&
        !yaEnEseTurno.has(p.empleadoId),
    )
    .map((p) => p.empleadoId);
}
