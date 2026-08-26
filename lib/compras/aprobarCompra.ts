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
export interface VeredictoAprobacion {
  ok: boolean;
  error?: string;
  /** Código HTTP que corresponde al motivo, para que las rutas no lo elijan. */
  estado?: number;
}

export function puedeAprobarLaCompra({
  asignadaA, usuarioId, estaEnLaLista, estadoCompra,
}: {
  asignadaA: string | null;
  usuarioId: string;
  estaEnLaLista: boolean;
  /** Se valida sólo si se pasa: el PATCH ya cambia de estado por su cuenta. */
  estadoCompra?: string;
}): VeredictoAprobacion {
  if (estadoCompra !== undefined && estadoCompra !== "PARA_COMPRAR") {
    return {
      ok: false,
      error: "Sólo se puede aprobar una compra que esté para comprar",
      estado: 409,
    };
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
