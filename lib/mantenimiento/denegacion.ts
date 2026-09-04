import { justificacionQueExplica } from "@/lib/core/justificacion";

/**
 * Denegar una orden de servicio tiene que decir por qué.
 *
 * Hasta ahora denegar una OS no existía en el sistema: ninguno de los cinco
 * estados de `ESTADOS_OS` lo era y en las 228 filas de la base no había ninguna
 * denegada. En la planilla sí se deniega, escribiendo el estado a mano, y la
 * palabra es `DENEGADO`. Se usa esa y no otra a propósito: si el sistema
 * escribiera «RECHAZADO», la planilla y la app estarían diciendo cosas distintas
 * del mismo pedido.
 */

/** El estado con el que una OS queda denegada. La palabra es la de la planilla. */
export const ESTADO_DENEGADO = "DENEGADO";

/** Si el cambio deniega la orden. */
export function esDenegacionDeOS(estado: unknown): boolean {
  return String(estado ?? "").trim().toUpperCase() === ESTADO_DENEGADO;
}

/** Si a esta denegación le falta el motivo que la explique. */
export function faltaLaJustificacion(estado: unknown, motivo: unknown): boolean {
  if (!esDenegacionDeOS(estado)) return false;
  return !justificacionQueExplica(motivo);
}

/**
 * En cuál de los dos estados de la planilla hay que escribir.
 *
 * La planilla de OS tiene dos y no uno:
 *
 * - **`SERVICIOS`**, columna de estado escrita a mano —la L—, es el maestro. Es
 *   el que lee el `FILTER` de cada pestaña de área (`estado="APROBADO"`), así
 *   que decide si la OS llega a la pestaña de su área o no. Su validación ya
 *   ofrece `DENEGADO` y la cuenta de servicio puede editarla.
 *
 *   La columna igual se busca por encabezado y no por la letra: `L1` coincide
 *   con el alias `ESTADO` —lo prueba la OS 26, cuyo estado y empresa los leyó
 *   la sincronización de esa hoja— y una hoja que se reordena rompería una
 *   letra fija sin avisar.
 * - **Cada pestaña de área** tiene además su propio estado de seguimiento,
 *   después de la columna K, para una OS ya aprobada y en curso.
 *
 * De ahí la regla: el estado se escribe donde vive la fila. Una OS que todavía
 * está en `SERVICIOS` se deniega ahí y no llega nunca a la pestaña —son 11 hoy,
 * las que no se aprobaron, justo las candidatas naturales a denegarse—; una que
 * ya está en su pestaña se deniega ahí y se queda.
 *
 * Escribir en `SERVICIOS` es quirúrgico: sólo esa celda. El resto de la hoja es
 * `QUERY(IMPORTRANGE(...))` y escribir ahí no cambia el dato, rompe la fórmula y
 * con ella toda la pestaña.
 */
export function dondeSeEscribeElEstado(
  pestana: string | null | undefined
): "maestro" | "seguimiento" | null {
  const p = String(pestana ?? "").trim();
  if (!p) return null;
  return p.toUpperCase() === "SERVICIOS" ? "maestro" : "seguimiento";
}

/** Qué se le dice a quien intentó denegar sin explicar. */
export const POR_QUE_HACE_FALTA =
  "Para denegar una orden de servicio hay que decir por qué: quien la pidió " +
  "necesita saber si lo hace el taller propio, si no había presupuesto o si se " +
  "resolvió de otra forma. Un guión o un «no» no alcanzan.";

/**
 * Si ese estado se puede escribir en el maestro sin correr filas.
 *
 * Las pestañas de área son un `FILTER(SERVICIOS!A2:K; área=…; estado="APROBADO")`,
 * así que **`APROBADO` es el único valor que mete la fila en una pestaña**. Y
 * cuando el `FILTER` levanta una fila, las de abajo se corren mientras el
 * seguimiento escrito a mano no se corre con ellas: quedan un proveedor y un
 * costo colgados de otra OS. Es el mismo daño que detecta `seguimientoHuerfano`.
 *
 * Denegar es justamente el caso seguro: la OS ya estaba afuera de la pestaña y
 * sigue afuera, así que no mueve nada. Aprobar desde la app se sigue haciendo a
 * mano en la planilla, que es como se hacía hasta ahora.
 */
export function seguroParaElMaestro(estado: unknown): boolean {
  return String(estado ?? "").trim().toUpperCase() !== "APROBADO";
}
