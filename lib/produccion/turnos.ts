import { sumarDias } from "@/lib/core/fechas";
import type { Turno } from "./types";

/**
 * El orden de los partes, que es lo que permite despejar la producción.
 *
 * En el Excel esto no existe como concepto: el "stock del turno anterior" es una
 * columna oculta que el Apps Script pisa al guardar, la misma para todas las
 * fechas. Acá es una función de dos ramas, y por eso no se puede desincronizar.
 */

/** Los dos turnos, en el orden en que ocurren dentro del día. */
export const TURNOS: readonly Turno[] = ["4_12", "12_20"];

export interface ClaveDeParte {
  /** "YYYY-MM-DD" */
  fecha: string;
  turno: Turno;
}

export function parteAnterior(clave: ClaveDeParte): ClaveDeParte {
  if (clave.turno === "12_20") return { fecha: clave.fecha, turno: "4_12" };
  return { fecha: sumarDias(clave.fecha, -1), turno: "12_20" };
}

export function comoSeLeeElTurno(turno: Turno): string {
  return turno === "4_12" ? "4 a 12" : "12 a 20";
}

/** Si el texto es uno de los dos turnos. Para validar lo que llega por la URL. */
export function esTurno(valor: unknown): valor is Turno {
  return valor === "4_12" || valor === "12_20";
}
