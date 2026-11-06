/**
 * Qué hay que anotar cuando un aviso no llega a la planilla.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────
 *
 * Es el mismo agujero que tuvieron el PATCH de las OT (26/10/2026, las órdenes
 * 2896 a 2898 y la 2908) y el de las órdenes de servicio. Tres caminos escriben
 * la planilla de avisos **después** de guardar y, si la escritura fallaba, sólo
 * le avisaban a la pantalla: enlazar una OT (`marcarElAviso`, columna
 * `OT ASIGNADA`), desestimar un aviso y retomarlo (columna `OBSERVACIONES`).
 *
 * `filaDeAviso` vuelve a leer las dos columnas, así que la próxima corrida de
 * `sincronizarAvisos` las pisaba con la celda vacía. No se perdía la decisión
 * —`work_order_id` y `desestimado_en` no se importan, y son los que mandan en
 * `finalDelAviso` y `estaDesestimado`— pero la planilla no se enteraba nunca.
 *
 * ── LA DIFERENCIA CON LAS OT Y LAS OS, QUE ES TODO EL DISEÑO ────────────────
 *
 * Allá la cola **rearma el registro entero desde la fila**, porque todas esas
 * columnas las escribe el sistema. Acá no se puede, y el motivo está medido:
 * la columna `OT ASIGNADA` **la escriben a mano**, y es el caso normal y no el
 * raro —182 de 186—. Por eso `loQueImpideDesenlazar` se niega a vaciarla
 * cuando el sistema no tiene la orden enlazada.
 *
 * Si el drenaje reescribiera las dos columnas desde la fila, un fallo de
 * `OBSERVACIONES` podría vaciar un número de OT que alguien acaba de tipear y
 * la sincronización todavía no importó: desestimar mira la copia del sistema
 * para negarse, y esa copia está vacía hasta el próximo sync. O sea, la cola
 * pisaría una celda que la app nunca escribió, por culpa de la otra columna.
 *
 * De ahí `sheets_pendiente_campos`: la cola guarda **qué campo falló** y el
 * drenaje completa exactamente esa operación. Es una columna de más contra las
 * otras dos tablas, y ésta es la razón.
 *
 * ── Y POR QUÉ ACÁ SÍ VIAJA LO VACÍO ─────────────────────────────────────────
 *
 * En las OT la regla es que lo vacío no viaja, para no borrar celdas que nadie
 * llenó. Acá es al revés y no es una excepción caprichosa: **dos de los cuatro
 * caminos son justamente vaciar** —desenlazar una OT y retomar un aviso
 * desestimado—, y con la regla de allá no se podrían encolar nunca. Lo que lo
 * vuelve seguro es lo de arriba: el drenaje sólo toca el campo que la app
 * acaba de escribir, así que vaciar es completar la operación que se pidió, no
 * pisar a nadie.
 *
 * Medido el 29/10/2026 contra la planilla de producción: 202 avisos de los dos
 * lados, 199 celdas con `OT ASIGNADA`, 5 con `OBSERVACIONES`, y **cero** donde
 * la planilla tenga texto que el sistema no tenga.
 */

/** Las dos columnas de la planilla de avisos que escribe el sistema. */
export type CampoDelAviso = "ot_asignada" | "observaciones";

const CAMPOS: readonly CampoDelAviso[] = ["ot_asignada", "observaciones"];

/** Dónde vive cada uno en la planilla, contando desde A = 0. */
const COLUMNA: Record<CampoDelAviso, number> = {
  ot_asignada: 9,
  observaciones: 11,
};

/** Un aviso, con lo que la planilla tiene que decir de él. */
export interface LoQueLaPlanillaDeAvisosNoSabe {
  ot_asignada: string | null | undefined;
  observaciones: string | null | undefined;
}

/**
 * Cómo se guardan los campos en `sheets_pendiente_campos`: separados por coma.
 *
 * Texto plano y no JSON a propósito: es una columna que alguien va a mirar con
 * un `select` cuando algo no llegue, y `ot_asignada` se lee mejor que
 * `["ot_asignada"]`.
 */
export const comoSeGuardanLosCampos = (campos: readonly CampoDelAviso[]): string =>
  campos.join(",");

/**
 * Los campos anotados, descartando lo que no reconocemos.
 *
 * Descarta en vez de fallar porque esto lee una columna de texto: un valor
 * viejo o escrito a mano no puede hacer que el drenaje entero se caiga. Lo que
 * no se reconoce simplemente no se reescribe, y eso lo deja a la vista — la
 * marca se limpia y el aviso vuelve a la importación normal.
 */
export function camposDelPendiente(guardado: string | null | undefined): CampoDelAviso[] {
  return String(guardado ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter((c): c is CampoDelAviso => (CAMPOS as readonly string[]).includes(c));
}

/**
 * Las celdas que hay que reescribir, o `null` si no hay ninguna.
 *
 * El valor sale **de la fila**, no de lo que se intentó escribir: si entre el
 * fallo y el drenaje alguien cambió de opinión, lo que vale es lo último. Un
 * `null` en la fila es una celda que hay que **vaciar**, que es la mitad de los
 * casos (desenlazar y retomar).
 *
 * `null` en vez de una lista vacía: una cola con filas que no tienen nada que
 * hacer deja de decir si algo está trabado.
 */
export function celdasDelAviso(
  aviso: LoQueLaPlanillaDeAvisosNoSabe,
  campos: readonly CampoDelAviso[]
): { columna: number; valor: string }[] | null {
  // Sin repetir, y en el orden del mapa: dos entradas para la misma columna
  // serían dos escrituras a la misma celda en el mismo lote.
  const unicos = CAMPOS.filter((c) => campos.includes(c));
  if (unicos.length === 0) return null;

  return unicos.map((campo) => ({
    columna: COLUMNA[campo],
    valor: String(aviso[campo] ?? "").trim(),
  }));
}

/** Lo que se guarda en la fila después de un intento. */
export interface IntentoDelAviso {
  sheets_pendiente: string | null;
  sheets_pendiente_campos: string | null;
  sheets_intentado_en: string;
}

/**
 * Qué anotar después de intentar escribir, salga o no.
 *
 * A diferencia del PATCH de una OT —que escribe sólo algunas celdas y por eso
 * no limpia la marca cuando sale bien—, acá **sí se limpia**: cada camino
 * escribe el campo entero que le toca, así que un éxito de `observaciones`
 * cierra todo lo que podía estar pendiente de `observaciones`. Lo que no se
 * toca es el pendiente de **otro** campo, y de eso se encarga el llamador
 * pasando `camposPrevios`.
 *
 * @param error         Lo que devolvió la escritura: `null` si salió.
 * @param campos        Los campos que esta operación escribió.
 * @param camposPrevios Lo que ya estaba anotado, para no borrarle el pendiente
 *                      al otro campo cuando éste sale bien.
 */
export function elIntentoDelAviso(
  error: string | null,
  campos: readonly CampoDelAviso[],
  camposPrevios: readonly CampoDelAviso[] = []
): IntentoDelAviso {
  const cuando = new Date().toISOString();

  if (error !== null) {
    const juntos = CAMPOS.filter((c) => campos.includes(c) || camposPrevios.includes(c));
    return {
      sheets_pendiente: error,
      sheets_pendiente_campos: comoSeGuardanLosCampos(juntos),
      sheets_intentado_en: cuando,
    };
  }

  // Salió. Queda pendiente sólo lo que este camino no escribió.
  const siguen = CAMPOS.filter((c) => camposPrevios.includes(c) && !campos.includes(c));
  return siguen.length > 0
    ? {
        sheets_pendiente:
          "Quedó pendiente de un intento anterior; se reintenta en la próxima sincronización.",
        sheets_pendiente_campos: comoSeGuardanLosCampos(siguen),
        sheets_intentado_en: cuando,
      }
    : { sheets_pendiente: null, sheets_pendiente_campos: null, sheets_intentado_en: cuando };
}
