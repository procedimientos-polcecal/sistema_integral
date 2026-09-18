/**
 * Lo puro de exportar hacia la planilla real ("SEGUIMIENTO EQUIPOS MÓVILES"):
 * dónde escribir, sin tocar la red. `lib/tallerVial/espejo.ts` es el I/O que
 * usa esto — mismo split que `lib/produccion/planilla.ts` / `espejo.ts`.
 */

import { fechaDeSheets } from "@/lib/core/fechaDeSheets";
import { codigoDesdeTextoLibre } from "./equipos";

export type BusquedaDeFila = { fila: number } | { fila: null; motivo: "no_existe" | "ambigua" };

/**
 * En qué fila de "HISTORIAL ESTADOS" está una fecha. `motivo` distingue "no
 * existe todavía" (se agrega una fila nueva, lo normal al cargar el día en
 * curso) de "ambigua" (la fecha está repetida — no se elige la primera ni se
 * agrega una tercera: eso empeora el problema en vez de arreglarlo).
 *
 * `columnaA` viene de leer la pestaña entera: el índice 0 es el encabezado
 * ("FECHA"), así que la búsqueda arranca en 1 y la fila de Sheets es
 * `i + 1` (1-indexada).
 */
export function filaDeLaFechaEnEstados(columnaA: readonly (readonly string[])[], fecha: string): BusquedaDeFila {
  let encontrada: number | null = null;
  for (let i = 1; i < columnaA.length; i++) {
    if (fechaDeSheets(columnaA[i]?.[0]) === fecha) {
      if (encontrada !== null) return { fila: null, motivo: "ambigua" };
      encontrada = i + 1;
    }
  }
  return encontrada !== null ? { fila: encontrada } : { fila: null, motivo: "no_existe" };
}

/**
 * En qué columna de "HISTORIAL ESTADOS" está un equipo, por su código
 * ("EM3"), o null si no aparece o aparece más de una vez. El índice es
 * 0-based (0 → columna A, que es "FECHA" y nunca matchea un código EM).
 */
export function columnaDelEquipoEnEstados(encabezado: readonly string[], equipoCodigo: string): number | null {
  let encontrada: number | null = null;
  for (let i = 1; i < encabezado.length; i++) {
    if (codigoDesdeTextoLibre(encabezado[i] ?? "") === equipoCodigo) {
      if (encontrada !== null) return null;
      encontrada = i;
    }
  }
  return encontrada;
}

/**
 * Si una fila de "DATOS" es el eco de una carga que ya nació en el SdG
 * (`espejarCarga` la escribe con su id en la columna H, la octava — ver el
 * comentario de la migración 20260918101859) — para que
 * `sincronizarCargasDesdeSheets` no la vuelva a insertar duplicada al leerla
 * de vuelta desde la planilla.
 */
export function esEcoDeCargaDelSistema(fila: readonly string[]): boolean {
  return Boolean(String(fila[7] ?? "").trim());
}
