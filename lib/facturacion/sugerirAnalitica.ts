import type { DistribucionAnalitica } from "./lineas";

/**
 * Qué distribución analítica se propone para una línea.
 *
 * Dos fuentes, y **no valen lo mismo**, así que van en cascada:
 *
 * 1. **El requerimiento.** Si la factura está vinculada a un RI, lo que quien
 *    pidió contestó en EQUIPO QUE SOLICITA **es** la imputación: ese desplegable
 *    usa el vocabulario del grupo, que es palabra por palabra el nombre de la
 *    cuenta analítica de Odoo. Eso no es una estadística: es el dato.
 * 2. **Lo que este proveedor repartió antes.** Cuando no hay requerimiento o no
 *    se pudo resolver. Acierta mucho menos, y por eso se muestra con el
 *    antecedente a la vista.
 *
 * ## Los números, medidos
 *
 * De las 255 opciones del desplegable, **241 son una única cuenta analítica en
 * cada empresa y ninguna es ambigua**. El camino viejo —factura → RI → ubicación
 * → equipo— cubría 206 de 1.969 requerimientos (10%), porque la mayoría de las
 * ubicaciones son lugares y no máquinas; se conserva como respaldo para los RI
 * viejos, que se cargaron antes de que el formulario preguntara.
 *
 * El historial cubre más y acierta menos. En el backtest —aprender de 8.700
 * líneas, predecir 2.200— con dos antecedentes y confianza 0,8 **propone en el
 * 38% y acierta el 78%**. Contra el 89% de la cuenta, es notoriamente más flojo:
 * a qué equipo fue un repuesto depende de qué se rompió esa semana, no del
 * proveedor.
 *
 * Por eso **nunca se completa sola**: se ofrece con la evidencia y la aplica una
 * persona, igual que la cuenta. Un 78% pre-llenado sería enseñar a apretar "sí"
 * sin mirar.
 */

export interface SugerenciaDeAnalitica {
  analitica: DistribucionAnalitica;
  /** Cómo se lee en pantalla: "EM6 - CATERPILLAR 950 G 100%". */
  detalle: string;
  /** De dónde salió, que es lo que dice cuánto confiar. */
  segun: "el equipo del requerimiento" | "este proveedor y este producto" | "este proveedor";
  /** La evidencia, cuando viene del historial. Vacío cuando es el equipo. */
  porque: string;
}

export type VecesPorReparto = Record<string, number>;

export interface HistorialDeAnalitica {
  porProducto: Record<string, VecesPorReparto>;
  delProveedor: VecesPorReparto;
}

/** Los mismos que la cuenta: salen del backtest, no de la intuición. */
const ANTECEDENTES_MINIMOS = 2;
const CONFIANZA_MINIMA = 0.8;

function elMasUsado(veces: VecesPorReparto): { reparto: string; veces: number; total: number } | null {
  const entradas = Object.entries(veces);
  if (!entradas.length) return null;

  const total = entradas.reduce((a, [, n]) => a + n, 0);
  const [reparto, cuantas] = entradas.sort((a, b) => b[1] - a[1])[0];
  return { reparto, veces: cuantas, total };
}

function describir(analitica: DistribucionAnalitica, nombres: Map<number, string>): string {
  return Object.entries(analitica)
    .sort((a, b) => b[1] - a[1])
    .map(([id, pct]) => `${nombres.get(Number(id)) ?? `#${id}`} ${pct}%`)
    .join(" · ");
}

export interface DeDondeSugerir {
  /**
   * La analítica que sale del requerimiento, si la factura tiene uno y se pudo
   * resolver. `porque` lo arma quien la resolvió, porque sólo ahí se sabe si
   * salió de lo que contestó la persona o del equipo de la ubicación.
   */
  delEquipo?: { id: number; nombre: string; porque: string } | null;
  historial?: HistorialDeAnalitica | null;
  /** Nombres de las analíticas, para poder mostrar el reparto. */
  nombres: Map<number, string>;
}

export function sugerirAnalitica(
  productoId: number | null,
  fuentes: DeDondeSugerir
): SugerenciaDeAnalitica | null {
  /*
   * El equipo primero y sin umbral: no es una probabilidad. Si el RI dice que la
   * compra fue para la CAT 950G, el gasto va a la CAT 950G.
   */
  if (fuentes.delEquipo) {
    const analitica: DistribucionAnalitica = { [String(fuentes.delEquipo.id)]: 100 };
    return {
      analitica,
      detalle: `${fuentes.delEquipo.nombre} 100%`,
      segun: "el equipo del requerimiento",
      porque: fuentes.delEquipo.porque,
    };
  }

  const historial = fuentes.historial;
  if (!historial) return null;

  const candidatos: { candidato: ReturnType<typeof elMasUsado>; segun: SugerenciaDeAnalitica["segun"] }[] = [
    {
      candidato: productoId === null ? null : elMasUsado(historial.porProducto[String(productoId)] ?? {}),
      segun: "este proveedor y este producto",
    },
    { candidato: elMasUsado(historial.delProveedor), segun: "este proveedor" },
  ];

  for (const { candidato, segun } of candidatos) {
    if (!candidato) continue;
    if (candidato.veces < ANTECEDENTES_MINIMOS) continue;
    if (candidato.veces / candidato.total < CONFIANZA_MINIMA) continue;

    let analitica: DistribucionAnalitica;
    try {
      analitica = JSON.parse(candidato.reparto) as DistribucionAnalitica;
    } catch {
      continue;
    }
    if (!Object.keys(analitica).length) continue;

    return {
      analitica,
      detalle: describir(analitica, fuentes.nombres),
      segun,
      porque:
        candidato.veces === candidato.total
          ? `las ${candidato.total} veces anteriores se repartió así, según ${segun}`
          : `${candidato.veces} de ${candidato.total} veces se repartió así, según ${segun}`,
    };
  }

  return null;
}
