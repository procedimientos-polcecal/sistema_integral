import type { Escala } from "./escala";

/**
 * Un valor medido del histórico, como se guarda.
 *
 * `valor` está **sin transformar**: es lo que dice la celda de la planilla. La
 * inferencia vive en `escala`.
 */
export interface FilaHistorica {
  fecha: string;
  /** La pestaña, literal. Permite filtrar lo que no es un ensayo. */
  hoja: string;
  /** Lo que decía la planilla: un producto, un cliente o un nombre de muestra. */
  origen_raw: string;
  determinacion: string;
  malla: number | null;
  valor: number;
  escala: Escala;
  unidad: string | null;
  /** Por qué hay que mirar esta fila. Null si no hay nada raro. */
  revisar: string | null;
  fila_excel: number;
}

/**
 * Una celda como la entrega `exceljs`: su valor ya resuelto y su fórmula si la
 * tiene.
 *
 * La fórmula importa por una sola razón y es la que justifica este tipo: las 22
 * celdas de agregación del libro se reconocen **por la fórmula y no por el
 * valor**, porque su valor es un número indistinguible de una medición.
 */
export interface Celda {
  valor?: unknown;
  formula?: string;
}
