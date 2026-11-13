/**
 * El punto de arranque de un ciclo encadenado, que lo carga una persona.
 *
 * ── POR QUÉ ESTO NO SALE DEL HISTORIAL ──────────────────────────────────────
 *
 * Es el único dato del mecanismo que no sale de otro dato, y es a propósito. Se
 * intentó deducirlo y no da: contando las rotaciones cerradas desde el último
 * cambio de cada equipo, dos de los cuatro dan **6 rotaciones de un ciclo de
 * 3**, porque el texto libre mezcla rotaciones con revisiones («Revisión de
 * rompedora y ver si es necesario rotar martillos») y con trabajos que sólo
 * nombran los martillos de paso. La cara que el texto nombra sí es confiable
 * —la OT 3067 del 11/11/2026 dice «a 4ta cara»— pero no todas la nombran.
 *
 * Arrancar cuatro ciclos sobre esa mezcla es exactamente lo que quien pidió
 * esto nombró como la razón por la que dejaría de confiar: «que genere OT sobre
 * martillos que ya se cambiaron». Cuatro fechas tipeadas una sola vez son más
 * baratas y más honestas.
 */

import { esFechaIso, hoyEnArgentina } from "@/lib/core/fechas";

/**
 * Qué le falta al arranque, **todo junto** y en castellano.
 *
 * De a uno obliga a mandar el formulario tres veces para enterarse de los tres
 * problemas, que es la vara que `validar()` fijó para el resto del sistema.
 *
 * @param repeticiones Cuántas hijas tiene el ciclo. La vuelta puede valer
 *   `repeticiones`: es el equipo que está en la última cara y cuyo próximo
 *   trabajo es el cambio, no una rotación más.
 */
export function loQueFaltaParaArrancar(
  p: { desde: unknown; vuelta_desde: unknown },
  repeticiones: number,
  hoy: string = hoyEnArgentina()
): string[] {
  const falta: string[] = [];

  // Una fecha futura no es «el último trabajo hecho»: es uno que no pasó, y el
  // ciclo generaría la orden siguiente más adelante todavía.
  if (!esFechaIso(p.desde) || String(p.desde) > hoy) {
    falta.push("la fecha del último trabajo");
  }

  const v = p.vuelta_desde;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > repeticiones) {
    falta.push("en qué vuelta quedó");
  }

  return falta;
}
