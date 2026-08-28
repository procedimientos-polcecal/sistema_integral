/**
 * Cuánto se compró para una máquina.
 *
 * El enlace vive en el catálogo de ubicaciones y no en el requerimiento —lo
 * decidió la 019, para mapear 38 filas una vez en vez de 1.825—, así que "los
 * RI de este equipo" son los que apuntan a alguna de sus ubicaciones.
 *
 * Se corta por año a propósito. La suma histórica son $939 millones nominales
 * repartidos en varios años de inflación: un solo total no significa nada, y
 * mostrarlo grande invita a compararlo con algo.
 */

/** Lo que el agregado necesita de un requerimiento. */
export interface RequerimientoConCosto {
  costo_iva: number | string | null;
  /** Cuándo se gastó. Es la fecha buena para imputar el año. */
  fecha_pedido: string | null;
  /** Cuándo se pidió. Respaldo para los RI que nunca llegaron a PEDIDO. */
  fecha: string | null;
}

export interface GastoDeUnAnio {
  anio: string;
  total: number;
  /** Cuántos RI de ese año suman al total. */
  conCosto: number;
  /** Cuántos no tienen costo cargado. No suman, pero existen. */
  sinCosto: number;
}

export interface GastoDelEquipo {
  /** Del más reciente al más viejo: es el orden en que se mira. */
  anios: GastoDeUnAnio[];
  total: number;
  conCosto: number;
  /**
   * Los RI sin `costo_iva`. Son 380 de 1.900 en el histórico, y contarlos
   * aparte en vez de sumarlos como cero es lo que evita que una máquina cara
   * parezca barata.
   */
  sinCosto: number;
}

/**
 * El costo tal como lo guarda la base.
 *
 * `costo_iva` es numeric, y PostgREST devuelve numeric como string cuando no
 * entra en un double sin perder precisión. Un valor ilegible se trata como
 * ausente y no como cero: cero es un dato —salió gratis— y vacío es que nadie
 * lo cargó.
 */
function costo(valor: number | string | null): number | null {
  if (valor === null || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * El año al que se imputa el gasto.
 *
 * `fecha_pedido` es cuándo se compró, que es lo que corresponde. Los RI que
 * nunca llegaron a PEDIDO no la tienen y caen en su fecha de alta, que es lo
 * más cerca que hay. Sin ninguna de las dos no hay año al que sumar.
 */
function anioDe(r: RequerimientoConCosto): string | null {
  const fuente = r.fecha_pedido ?? r.fecha;
  if (!fuente) return null;
  const anio = String(fuente).slice(0, 4);
  return /^\d{4}$/.test(anio) ? anio : null;
}

export function gastoPorAnio(requerimientos: RequerimientoConCosto[]): GastoDelEquipo {
  const porAnio = new Map<string, GastoDeUnAnio>();
  let total = 0;
  let conCosto = 0;
  let sinCosto = 0;

  for (const r of requerimientos) {
    const monto = costo(r.costo_iva);
    if (monto === null) sinCosto++;
    else {
      total += monto;
      conCosto++;
    }

    const anio = anioDe(r);
    if (anio === null) continue;

    const fila = porAnio.get(anio) ?? { anio, total: 0, conCosto: 0, sinCosto: 0 };
    if (monto === null) fila.sinCosto++;
    else {
      fila.total += monto;
      fila.conCosto++;
    }
    porAnio.set(anio, fila);
  }

  return {
    anios: [...porAnio.values()].sort((a, b) => b.anio.localeCompare(a.anio)),
    total,
    conCosto,
    sinCosto,
  };
}
