/**
 * El resumen por período y grupo de envase.
 *
 * Reemplaza la pestaña `Entradas  Salidas x Envase`, y **a propósito no da lo
 * mismo que ella**. Esa pestaña tiene dos problemas medidos:
 *
 * 1. Agrupa los ingresos y egresos con comodines sobre la **descripción**
 *    (`"*2,10*"`, `"*1,20*"`, `"*NUEVOS*"`), y
 *    `BOLSONES NUEVOS TORRACO (1,20 P 02)` matchea los dos: lo cuenta dos
 *    veces. Acá se agrupa por el `grupo` del artículo, que sale de la columna
 *    K — la misma que esa pestaña usa para su columna de stock, y que agrupa
 *    bien.
 * 2. Su `STOCK FINAL` sólo suma los artículos que tienen **al menos un
 *    movimiento**. Acá suma todos los del grupo.
 *
 * Que dé distinto no es un bug: está explicado en la pantalla.
 */

export interface ArticuloDelInforme {
  id: string;
  codigo: string;
  grupo: string | null;
  stock_actual: number;
}

export interface MovimientoDelInforme {
  articulo_id: string;
  /** ISO corto, `aaaa-mm-dd`. Puede faltar: la columna de fecha no es obligatoria. */
  fecha: string | null;
  entrada: number;
  salida: number;
  rotura: number;
  despacho: number;
}

export interface Rango {
  /** ISO corto. Los dos extremos entran. */
  desde: string;
  hasta: string;
}

export interface FilaDelInforme {
  /** `null` es el renglón "Sin grupo", que va último. */
  grupo: string | null;
  ingresos: number;
  egresos: number;
  rotura: number;
  despacho: number;
  /**
   * El stock de hoy, no el del período. Es la misma aclaración que la planilla
   * lleva al pie: el saldo no es la diferencia entre los ingresos y los egresos
   * del rango.
   */
  stock: number;
  articulos: number;
}

export function resumirPorGrupo(
  articulos: ArticuloDelInforme[],
  movimientos: MovimientoDelInforme[],
  rango: Rango
): FilaDelInforme[] {
  const grupoDe = new Map(articulos.map((a) => [a.id, a.grupo]));
  const filas = new Map<string | null, FilaDelInforme>();

  const filaDe = (grupo: string | null): FilaDelInforme => {
    let f = filas.get(grupo);
    if (!f) {
      f = { grupo, ingresos: 0, egresos: 0, rotura: 0, despacho: 0, stock: 0, articulos: 0 };
      filas.set(grupo, f);
    }
    return f;
  };

  // El stock y el conteo salen de los artículos y no de los movimientos: un
  // artículo que nunca se movió igual tiene stock, y dejarlo afuera es el
  // agujero de la planilla.
  for (const a of articulos) {
    const f = filaDe(a.grupo);
    f.stock += a.stock_actual;
    f.articulos += 1;
  }

  for (const m of movimientos) {
    // Sin fecha no se puede ubicar en el período. No se cuenta ni se supone.
    if (!m.fecha) continue;
    const dia = m.fecha.slice(0, 10);
    if (dia < rango.desde || dia > rango.hasta) continue;

    const f = filaDe(grupoDe.get(m.articulo_id) ?? null);
    f.ingresos += m.entrada;
    f.egresos += m.salida;
    f.rotura += m.rotura;
    f.despacho += m.despacho;
  }

  // Por nombre, y "Sin grupo" último: sin un orden fijo la tabla cambia de
  // forma entre dos corridas iguales y deja de poder compararse.
  return [...filas.values()].sort((a, b) => {
    if (a.grupo === null) return 1;
    if (b.grupo === null) return -1;
    return a.grupo.localeCompare(b.grupo, "es");
  });
}
