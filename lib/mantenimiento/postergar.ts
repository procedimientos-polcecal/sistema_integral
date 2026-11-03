/**
 * Postergar una orden de trabajo: correrle la fecha de ejecución.
 *
 * ── LO QUE HAY QUE SABER ANTES DE TOCAR ESTO ────────────────────────────────
 *
 * Postergar **no es un update y listo**. La fecha de ejecución de una OT es la
 * columna J del master, y esa columna es derrame de un `QUERY(IMPORTRANGE())`:
 * escribir ahí no queda —o rompe el derrame con `#REF!`, o el derrame lo pisa
 * al recalcular—. La fecha de verdad vive en el libro de respuestas, pestaña
 * `Altas del sistema`, columna `FECHA COMPROMETIDA`, y de ahí derrama al
 * master **horas después**: las cinco OT medidas el 21/10/2026 tardaron de 3 a
 * 53 horas.
 *
 * De eso salen las dos reglas que gobiernan este archivo:
 *
 * 1. **Sólo se posterga una OT que creó el sistema** (`app_created`). La de una
 *    respuesta de formulario vive en la pestaña que maneja Forms, y escribir
 *    ahí fue lo que corrió la OT 2796 dos lugares el 16/10/2026.
 * 2. **La fecha nueva queda anotada en `fecha_ejecucion_pendiente`** hasta que
 *    el derrame la refleje. Sin eso, la sincronización del medio lee la J vieja
 *    y la pisa — y encima la cuenta como divergencia, disparando el push de
 *    `mant-divergencias`.
 */

import { sumarDias } from "@/lib/core/fechas";

/**
 * Lo más lejos que se puede empujar una orden de una vez.
 *
 * No es capricho: esto escribe en la planilla que mira la planta, y un dedo de
 * más —300 en lugar de 3— manda la orden a 2027. Deshacerlo no es apretar
 * «cancelar»: hay que volver a escribir la celda de `Altas del sistema` y
 * esperar otra vez el derrame. Noventa días es un trimestre, que es más de lo
 * que cualquiera de las tres razones conocidas justifica.
 */
export const MAXIMO_DE_DIAS = 90;

/** La fecha corrida, o `null` si no hay de dónde partir. */
export function laNuevaFecha(fecha: string | null | undefined, dias: number): string | null {
  if (!fecha) return null;
  return sumarDias(fecha, dias);
}

export interface LoQuePideLaPostergacion {
  razon: unknown;
  dias: unknown;
  justificacion: unknown;
}

/**
 * Qué le falta al pedido, **todo junto**.
 *
 * La justificación es obligatoria y ése es el punto del diseño: si hay un
 * camino que posterga sin escribir nada, en un mes no hay ninguna
 * justificación. Y en blanco no cuenta como escrita.
 */
export function loQueFaltaParaPostergar(p: LoQuePideLaPostergacion): string[] {
  const falta: string[] = [];

  if (!String(p.razon ?? "").trim()) falta.push("la razón");

  const dias = Number(p.dias);
  if (!Number.isInteger(dias) || dias <= 0 || dias > MAXIMO_DE_DIAS) {
    falta.push("cuántos días");
  }

  if (!String(p.justificacion ?? "").trim()) falta.push("la justificación");

  return falta;
}
