/**
 * Los días del cuaderno que ya tenían renglones cargados.
 *
 * El parte de Candia trae número preimpreso, así que un repetido se detecta
 * solo. **El cuaderno no tiene número**: la única pista de que una hoja se
 * subió dos veces es que trae renglones de un día que ya tiene renglones de ese
 * contratista. La pantalla lo dice y deja elegir —reemplazar los de ese día, o
 * dejar los dos—, y **no bloquea** a propósito: un día puede estar escrito en
 * dos hojas.
 *
 * Es pura: la ruta lee los renglones y esta función decide. Lo mismo vale para
 * la vista previa y para el borrado, que **recalcula** con ella en vez de creer
 * una lista de ids que le mande el navegador.
 *
 * **Se niega a reemplazar un día si alguno de sus renglones ya generó su OT**
 * —o está en un grupo que la generó—. Borrarlos dejaría órdenes que nadie puede
 * rastrear al papel, y generar los nuevos duplicaría las que ya existen; y una
 * OT escrita en la planilla se borra a mano, fila por fila. Es la misma
 * negativa que tiene el borrado de una carga.
 */

export type RenglonPrevio = {
  id: string;
  cuaderno_id: string;
  foto_id: string | null;
  fecha: string | null;
  tarea: string;
  orden_trabajo_id: string | null;
  grupo_id: string | null;
};

/** Un renglón del grupo de alguno de los previos, esté o no ese día. */
export type MiembroDeGrupo = { grupo_id: string | null; orden_trabajo_id: string | null };

export type DiaRepetido = {
  fecha: string;
  /** Los renglones que ya estaban ese día (no los que acaban de entrar). */
  renglon_ids: string[];
  cantidad: number;
  /** Cuántos de los que ya estaban son de otra carga y no de ésta. */
  de_otras_cargas: number;
  /** Hasta tres tareas, para que quien mira reconozca de qué día habla. */
  tareas: string[];
  /** Cuántos ya generaron OT, directa o por su grupo. */
  con_ot: number;
  se_puede_reemplazar: boolean;
  /** Por qué no, en castellano. Null cuando se puede. */
  motivo: string | null;
};

/**
 * Los días repetidos entre lo que acaba de entrar y lo que ya estaba.
 *
 * @param fechasNuevas  las fechas de los renglones de las fotos recién leídas
 * @param previos       los renglones **del contratista** de esas fechas
 * @param fotosNuevas   las fotos recién leídas: sus renglones no se cuentan
 *                      como previos de sí mismos, y así los dos renglones de un
 *                      día que cruza el borde de una hoja no se avisan
 * @param cargaActual   la carga en la que se está leyendo
 * @param miembros      los renglones de los grupos de los previos
 */
export function diasRepetidos(
  fechasNuevas: readonly (string | null)[],
  previos: readonly RenglonPrevio[],
  fotosNuevas: ReadonlySet<string>,
  cargaActual: string,
  miembros: readonly MiembroDeGrupo[] = []
): DiaRepetido[] {
  const dias = new Set(fechasNuevas.filter((f): f is string => !!f));

  // Un grupo con una orden la tiene entera: aunque el renglón que se borraría
  // no la tenga, la orden cuenta sus horas.
  const gruposConOT = new Set(
    miembros.filter((m) => m.grupo_id && m.orden_trabajo_id).map((m) => m.grupo_id as string)
  );

  const porDia = new Map<string, RenglonPrevio[]>();
  for (const r of previos) {
    if (!r.fecha || !dias.has(r.fecha)) continue;
    if (r.foto_id && fotosNuevas.has(r.foto_id)) continue;
    const lista = porDia.get(r.fecha);
    if (lista) lista.push(r);
    else porDia.set(r.fecha, [r]);
  }

  const salida: DiaRepetido[] = [];
  for (const [fecha, rs] of porDia) {
    const bloqueados = rs.filter(
      (r) => r.orden_trabajo_id || (r.grupo_id && gruposConOT.has(r.grupo_id))
    ).length;
    const cantidad = rs.length;
    salida.push({
      fecha,
      renglon_ids: rs.map((r) => r.id),
      cantidad,
      de_otras_cargas: rs.filter((r) => r.cuaderno_id !== cargaActual).length,
      tareas: [...new Set(rs.map((r) => r.tarea.trim()))].slice(0, 3),
      con_ot: bloqueados,
      se_puede_reemplazar: bloqueados === 0,
      motivo:
        bloqueados === 0
          ? null
          : `${bloqueados === 1 ? "Un renglón de ese día ya generó" : `${bloqueados} renglones de ese día ya generaron`} ` +
            `su orden de trabajo, así que no se reemplaza: borrarlos dejaría órdenes que nadie puede rastrear al papel, ` +
            `y generar los nuevos duplicaría las que ya existen. Si está repetido, hay que corregir esas OT a mano.`,
    });
  }
  return salida.sort((a, b) => a.fecha.localeCompare(b.fecha));
}
