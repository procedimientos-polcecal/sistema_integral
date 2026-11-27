/**
 * Qué filas de una comparativa las escribió el propio sistema.
 *
 * Una cotización cargada en el SdG deja una copia de respaldo en la planilla del
 * artículo, con su id en la columna `ID SISTEMA`. Al releer la planilla esa copia
 * no puede entrar de nuevo como un presupuesto nuevo: sería un duplicado.
 */

/** La celda `ID SISTEMA` de la fila trae un id que el sistema ya tiene. */
export function esEcoDelSistema(
  fila: string[],
  idxId: number,
  idsConocidos: Set<string>
): boolean {
  if (idxId < 0) return false;
  const id = String(fila[idxId] ?? "").trim();
  return id !== "" && idsConocidos.has(id);
}

/**
 * Lo que las rutas de relectura usan para saltear una fila: es eco si lo es por
 * su id (cláusula a) o, en su defecto, por su número de fila (cláusula b).
 *
 * TRANSICIÓN, cláusula (b): las cotizaciones 'app' anteriores a la columna
 * `ID SISTEMA` viven en planillas que no la tenían, así que su fila no trae id y
 * el número de fila es el único vínculo que hay —el mismo que ya usaba el código
 * viejo—. Sólo vale cuando la fila NO trae id: si trae uno que el sistema no
 * conoce, alguien la escribió afuera y entra aunque el número coincida. Se puede
 * borrar el día que esas cotizaciones tengan id.
 *
 * **`filasSinIdEscrito` NO son todas las filas de las cotizaciones 'app', y la
 * diferencia es la que evita saltear el presupuesto de otro.** Un número de fila
 * guardado envejece —en estas planillas se insertan filas en el medio— y la fila
 * 150 de hoy puede ser un presupuesto que alguien tipeó a mano. El conjunto sale
 * de `ubicarLoDelSistema()`, que deja adentro sólo las 'app' cuyo id **no**
 * aparece escrito en la planilla: ésas son las viejas, y para ellas el número de
 * fila sigue siendo el único vínculo que hay.
 */
export function esEcoAlReleer(
  fila: string[],
  idxId: number,
  idsConocidos: Set<string>,
  numeroFila: number,
  filasSinIdEscrito: Set<number>
): boolean {
  if (esEcoDelSistema(fila, idxId, idsConocidos)) return true;
  const traeId = idxId >= 0 && String(fila[idxId] ?? "").trim() !== "";
  return !traeId && filasSinIdEscrito.has(numeroFila);
}

/** Una cotización que cargó el sistema, con la fila donde cree que la escribió. */
export interface CotizacionDelSistema {
  id: string;
  drive_fila: number | null;
}

/** Una fila de la planilla con su número real en la hoja. */
export interface FilaDeLaPlanilla {
  fila: string[];
  numeroFila: number;
}

export interface LoDelSistemaEnLaPlanilla {
  /** Todos los ids de las 'app' del pedido: la cláusula (a) de `esEcoAlReleer`. */
  idsDelSistema: Set<string>;
  /** Las filas de las 'app' que NO tienen su id escrito: la cláusula (b). */
  filasSinId: Set<number>;
  /** Dónde está hoy cada una que sí lo tiene, cuando difiere de lo guardado. */
  correcciones: { id: string; drive_fila: number }[];
}

/**
 * Cruza lo que el sistema cargó contra lo que la planilla tiene escrito hoy.
 *
 * Es la re-sincronización que se perdió al dejar de borrar y reinsertar la fila
 * 'app' en cada relectura: antes su `drive_fila` se corregía solo porque la fila
 * se volvía a leer, y ahora la cotización sobrevive **para siempre con el número
 * que tenía el día que se escribió**. En estas planillas se insertan filas en el
 * medio, así que ese número envejece, y de ahí salen los dos daños que esta
 * función evita:
 *
 * - **La fila que trae un id conocido dice dónde está esa cotización hoy**, así
 *   que su número se corrige. El id es para *reconocer*; la fila, para *volver a
 *   tocar* —vaciarla al borrar el presupuesto—, y un número viejo vacía la fila
 *   de otro.
 * - **La cláusula (b) se angosta a las que no tienen su id escrito.** Con todas
 *   adentro, la fila 150 —que hoy puede ser un presupuesto tipeado a mano del
 *   mismo pedido— se salteaba como si fuera eco propio, y ese presupuesto no
 *   entraba nunca al sistema sin que nada lo dijera.
 *
 * `filas` son las de ese pedido (`filasParaEsteRi`), que es donde puede estar su
 * copia. Un id de la planilla que el sistema no conoce no ubica nada: alguien lo
 * escribió afuera.
 */
export function ubicarLoDelSistema(
  filas: FilaDeLaPlanilla[],
  idxId: number,
  delSistema: CotizacionDelSistema[]
): LoDelSistemaEnLaPlanilla {
  const idsDelSistema = new Set(delSistema.map((c) => String(c.id)));

  const filaPorId = new Map<string, number>();
  if (idxId >= 0) {
    for (const { fila, numeroFila } of filas) {
      const id = String(fila[idxId] ?? "").trim();
      if (id === "" || !idsDelSistema.has(id)) continue;
      // La primera gana: dos filas con el mismo id sería la planilla duplicada
      // a mano, y elegir la de más arriba es estable entre lecturas.
      if (!filaPorId.has(id)) filaPorId.set(id, numeroFila);
    }
  }

  const filasSinId = new Set<number>();
  const correcciones: { id: string; drive_fila: number }[] = [];

  for (const c of delSistema) {
    const id = String(c.id);
    const donde = filaPorId.get(id);
    if (donde === undefined) {
      // No está escrita en la planilla: es una de las viejas, y su número de
      // fila es lo único que hay para reconocerla.
      if (c.drive_fila !== null) filasSinId.add(c.drive_fila);
      continue;
    }
    if (c.drive_fila !== donde) correcciones.push({ id, drive_fila: donde });
  }

  return { idsDelSistema, filasSinId, correcciones };
}
