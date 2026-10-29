/**
 * Los tipos del parte de los molinos que sale del PC Robot. Viven aparte del
 * parseo porque los comparten el lector de CSV, el cálculo de turnos y las
 * rutas, y ninguno debería importar al otro sólo para nombrar un tipo.
 */

/**
 * La hora a la que el robot cierra cada archivo de corte. **El turno lo decide
 * esta hora y nunca la posición de la columna**: Filler 1 y Filler 2 numeran
 * sus archivos distinto, y atar el turno al número de archivo los cruzaría.
 */
export type CorteDeTurno = "3:59" | "11:59" | "19:59" | "23:59";

/**
 * El turno con su duración teórica en el nombre: `20_00` es el que cierra
 * a las 23:59 (240 min), `00_04` el de las 3:59 (240), `04_12` el de las 11:59
 * (480) y `12_20` el de las 19:59 (480).
 */
export type TurnoDeMolino = "20_00" | "00_04" | "04_12" | "12_20";

export type EstadoDeTurno = "normal" | "acumulado" | "inconsistente" | "huerfano";

/** Un renglón del robot ya leído, todavía sin interpretar como turno. */
export interface FilaCruda {
  /** "YYYY-MM-DD". El CSV la trae d/m/yyyy. */
  fecha: string;
  corte: CorteDeTurno;
  kg: number;
  minutos: number;
  /**
   * Los vocabularios son distintos por molino y es a propósito: Filler 1 usa
   * `membranero`/`dolomita`/`caliza` y Filler 2 usa los seis
   * `piedra_*`/`arena_*`, porque muelen cosas distintas.
   */
  porMaterial: Record<string, number>;
}
