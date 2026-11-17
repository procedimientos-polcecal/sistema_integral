/**
 * A qué celdas de la columna ESTADO les falta su fórmula.
 *
 * ── POR QUÉ ESTO CORRE SOLO ─────────────────────────────────────────────────
 *
 * La `M` del master no tiene fórmula de columna: de sus 2.299 celdas medidas el
 * 29/10/2026, 2.291 eran literales y sólo cinco sueltas llevaban
 * `=IF(J="","",L)`. Quien escribe ahí es el sistema, al exportar el estado de
 * una orden.
 *
 * Pero **una OT que entra por el formulario no pasa por ninguna ruta del SdG**,
 * así que nadie le escribe la M: nace con el ESTADO en blanco y se queda así.
 * Medido el 02/11/2026: tres nuevas en tres días —2949, 2950 y 2951, las tres
 * `app_created = false` y con `sheets_intentado_en` en «nunca»—. El arreglo del
 * 29/10 tapó el lado del sistema; éste es el otro lado.
 *
 * Y no es cosmético: mientras la celda está vacía, esa orden **no tiene estado
 * para quien mira la planilla**, ni siquiera cuando se vence — la L calcula
 * «Atrasado» y la M al lado sigue en blanco.
 *
 * ── LO QUE DECIDE, Y LO QUE NO ──────────────────────────────────────────────
 *
 * Esto es puro: recibe lo que se leyó y dice qué escribir. Hablar con Google es
 * de quien llama —la sincronización, o el script a mano—, y los dos usan esta
 * misma función para que no puedan decidir distinto.
 */

import { celdaDeEstado } from "./ordenes";

/**
 * Cuántas celdas en blanco son demasiadas para ser verdad.
 *
 * Es el mismo freno que `borradoDeEspejo` y por la misma razón: **una planilla
 * recalculando devuelve vacías las celdas que no resolvió**, y «vacío» es justo
 * el criterio de esto. Sin freno, una corrida en mal momento escribiría la
 * fórmula encima de dos mil estados cargados a mano — el 13/10/2026 una lectura
 * así devolvió 2 filas de 623.
 *
 * Cincuenta es holgado contra lo real: en tres días aparecieron tres.
 */
export const FRENO_DE_FORMULAS = 50;

export interface CeldaDeEstado {
  ot_number: number;
  /** Como la cuenta la planilla: la primera fila es la 1. */
  fila: number;
  columna: number;
  valor: string;
}

export interface LoQueFalta {
  celdas: CeldaDeEstado[];
  /** Con texto no se escribe **nada**, y hay que decir por qué. */
  freno: string | null;
}

/**
 * Las celdas del estado que están vacías **y sin fórmula**.
 *
 * Las dos condiciones juntas, y ahí está lo que hace que esto se pueda correr
 * cada pocas horas sin romper nada: una celda que ya tiene la fórmula **se ve
 * vacía** cuando su OT no tiene fecha de ejecución —el caso de la 622— y
 * mirando sólo el texto se la propondría en cada corrida para siempre.
 *
 * @param filas        Los valores de la pestaña, con el encabezado en la 0.
 * @param formulaDeM   Por fila, si su celda de ESTADO es una fórmula.
 * @param columnaOt    Dónde está el N° de OT (A = 0).
 * @param columnaEstado Dónde está el ESTADO.
 */
export function lasQueLesFaltaLaFormula(
  filas: readonly (readonly unknown[])[],
  formulaDeM: readonly (readonly boolean[])[],
  columnaOt: number,
  columnaEstado: number
): LoQueFalta {
  const celdas: CeldaDeEstado[] = [];

  for (let i = 1; i < filas.length; i++) {
    const ot = Number(String(filas[i]?.[columnaOt] ?? "").trim());
    if (!ot || isNaN(ot)) continue;
    if (String(filas[i]?.[columnaEstado] ?? "").trim() !== "") continue;
    if (formulaDeM[i]?.[0] === true) continue;

    const fila = i + 1;
    celdas.push({
      ot_number: ot, fila, columna: columnaEstado,
      valor: celdaDeEstado("POR_HACER", fila),
    });
  }

  if (celdas.length > FRENO_DE_FORMULAS) {
    return {
      celdas: [],
      freno:
        `Habría que escribir ${celdas.length} celdas de ESTADO, más de las ${FRENO_DE_FORMULAS} ` +
        `que esto acepta. Una planilla recalculando devuelve vacías las celdas que no ` +
        `resolvió, así que esto parece eso y no un montón de órdenes sin estado. No se ` +
        `escribió nada: mirá la planilla antes de forzarlo.`,
    };
  }

  return { celdas, freno: null };
}
