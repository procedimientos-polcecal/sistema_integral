/**
 * Qué costó la vez pasada lo mismo que se está pidiendo.
 *
 * Un requerimiento no tiene monto hasta que se compró —medido el 19/10/2026:
 * cero en SIN_INICIAR, cero en comparativa, uno de cuarenta en APROBADO—, así
 * que quien lo prioriza o le busca presupuestos no sabe si va a ser caro. Lo
 * que sí se puede saber es qué salió la última vez.
 *
 * ── POR QUÉ SE MUESTRA Y NO SE MARCA ────────────────────────
 *
 * Porque esto es un **hecho sobre un RI pasado**, no una inferencia sobre éste.
 * Se midió marcar automáticamente por histórico, simulando hacia adelante en el
 * tiempo: acierta el 93% con la regla más estricta —código exacto y que el
 * artículo SIEMPRE haya sido caro, que recupera el 9%— y el 82% con la más
 * amplia, que recupera el 20%. O sea que se equivoca entre 1 de cada 14 y 1 de
 * cada 5, y un aviso que se equivoca una de cada cinco veces enseña a ignorar
 * los avisos.
 *
 * Mostrando el número no hay nada que pueda estar mal: el RI 2063 costó
 * 16.885.438 y eso es cierto. Juzga la persona, con el dato delante y la marca
 * manual a un clic.
 *
 * El techo tampoco lo pone el algoritmo: de los 136 requerimientos caros del
 * histórico, 85 son **únicos** —una compresora, un balde, unos inyectores— y de
 * eso no hay nada que aprender. Lo que se repite son los consumibles: ladrillos
 * refractarios, bolsas de cal, bolsones, grillas.
 */

/** Un requerimiento anterior del mismo artículo, que ya tiene monto. */
export interface RiPasado {
  nro_ri: number;
  fecha: string | null;
  monto_conocido: number;
  proveedor: string | null;
}

export interface HistoricoDelArticulo {
  /** Cuántas veces se pidió antes. */
  veces: number;
  /** El pedido anterior más nuevo. */
  ultimo: RiPasado;
  maximo: number;
  minimo: number;
}

/**
 * Resume los pedidos anteriores del mismo artículo.
 *
 * Devuelve el máximo **y** el mínimo, no un promedio: de los 26 grupos de
 * artículos repetidos, 10 fueron caros a veces y baratos otras. Un solo número
 * se lee como una promesa; el rango muestra cuándo el precio salta y deja que
 * la persona decida si este pedido se parece al caro o al barato.
 */
export function resumenDelHistorico(pasados: RiPasado[]): HistoricoDelArticulo | null {
  if (pasados.length === 0) return null;

  // Por número de RI y no por fecha: la fecha puede venir vacía —son 2.159
  // filas que vinieron de una planilla— y el número es la única cronología que
  // este módulo tiene siempre.
  const ultimo = pasados.reduce((a, b) => (b.nro_ri > a.nro_ri ? b : a));
  const montos = pasados.map((p) => p.monto_conocido);

  return {
    veces: pasados.length,
    ultimo,
    maximo: Math.max(...montos),
    minimo: Math.min(...montos),
  };
}
