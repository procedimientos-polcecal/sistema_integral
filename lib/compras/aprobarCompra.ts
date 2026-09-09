/**
 * Quién puede aprobar la compra de un requerimiento.
 *
 * Son dos condiciones y hacen falta las dos:
 *
 *  - **Estar asignado.** En la planilla el estado dice a quién le toca
 *    —"PARA COMPRAR (NICO)"—, así que si aprueba otro los dos lados quedan
 *    diciendo cosas distintas.
 *  - **Seguir en la lista de aprobadores.** Alguien pudo quedar asignado y
 *    después salir de ella. Ser admin del módulo no alcanza: administrar
 *    Compras y autorizar un gasto son cosas distintas.
 *
 * Vive acá porque hay dos caminos que llegan a lo mismo —elegir un presupuesto,
 * y aprobar sin comparativa— y la regla tiene que ser una sola. Cuando estaba
 * escrita en cada ruta, una de las dos se olvidó de la lista.
 */

import { ESTADOS_DECIDIDOS } from "./congelada";
export interface VeredictoAprobacion {
  ok: boolean;
  error?: string;
  /** Código HTTP que corresponde al motivo, para que las rutas no lo elijan. */
  estado?: number;
}

export function puedeAprobarLaCompra({
  asignadaA, usuarioId, estaEnLaLista, estadoCompra, yaDecidida,
}: {
  asignadaA: string | null;
  usuarioId: string;
  estaEnLaLista: boolean;
  /** Se valida sólo si se pasa: el PATCH ya cambia de estado por su cuenta. */
  estadoCompra?: string;
  /**
   * Si la compra **ya está decidida de verdad**: hay un presupuesto elegido o el
   * requerimiento tiene proveedor. Se valida sólo si se pasa.
   */
  yaDecidida?: boolean;
}): VeredictoAprobacion {
  if (estadoCompra !== undefined && estadoCompra !== "PARA_COMPRAR") {
    /*
     * La excepción: el estado dice que la compra se decidió y no se decidió
     * nada.
     *
     * Son **35 requerimientos** en APROBADO sin proveedor ni presupuesto
     * elegido: el estado vino de la columna de la planilla, no de que alguien
     * eligiera acá. Exigir el estado exacto los dejaba en un pozo —la pantalla
     * congelada esconde lo que permitiría resolverlo, y esta ruta contesta 409—
     * y la única salida era cambiar el estado a mano.
     *
     * Lo que la regla quiere evitar es **aprobar dos veces**, no un estado
     * puntual. Así que si no hay nada decidido, se deja aprobar: es la primera
     * vez, por más que el estado diga otra cosa.
     */
    const inconsistente = ESTADOS_DECIDIDOS.includes(estadoCompra) && yaDecidida === false;

    if (!inconsistente) {
      return {
        ok: false,
        error: "Sólo se puede aprobar una compra que esté para comprar",
        estado: 409,
      };
    }
  }
  if (asignadaA !== usuarioId) {
    return {
      ok: false,
      error: "Esta compra la tiene que aprobar la persona a la que se le asignó",
      estado: 403,
    };
  }
  if (!estaEnLaLista) {
    return {
      ok: false,
      error: "Aprobar una compra requiere estar en la lista de aprobadores",
      estado: 403,
    };
  }
  return { ok: true };
}

/**
 * ¿Este guardado **aprueba** la compra, o sólo edita una ya aprobada?
 *
 * El formulario de gestión de compra manda `estado_compra` siempre, con o sin
 * cambio. Sin esta distinción, tocar el proveedor, el costo o el N° de orden de
 * una compra ya aprobada se leía como aprobarla de nuevo, y eso tenía dos
 * consecuencias:
 *
 *  - **No se podía guardar nada** salvo que quien editaba fuera la persona
 *    asignada y estuviera en la lista de aprobadores. El resto recibía un 403
 *    —"la tiene que aprobar la persona a la que se le asignó"— y el cambio se
 *    perdía. Editar una compra aprobada es tarea de Compras; aprobarla no.
 *  - **Se reescribía quién aprobó y cuándo** en cada guardado, borrando el
 *    registro real de la decisión.
 *
 * Aprobar es *pasar a* aprobado. Guardar una compra que ya lo estaba, no.
 */
export function esAprobacionNueva(
  estadoActual: string,
  estadoNuevo: string | undefined
): boolean {
  return estadoNuevo === "APROBADO" && estadoActual !== "APROBADO";
}
