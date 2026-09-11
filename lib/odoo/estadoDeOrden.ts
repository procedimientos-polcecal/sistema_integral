/**
 * En qué estado está una orden de compra de Odoo, y qué se puede hacer con ella.
 *
 * Es la única parte de confirmar que no es una llamada de red, y por eso vive
 * acá: la regla de **cuándo se puede confirmar** decide si un botón se muestra
 * o no, y equivocarse tiene dos formas caras. Ofrecer confirmar una cancelada
 * revive a mano algo que alguien dio de baja del otro lado; ofrecerlo sobre una
 * que espera aprobación manda a apretar un botón que Odoo va a rechazar.
 *
 * Los estados son los de `purchase.order` en Odoo 17.
 */

/** Cómo se llama cada estado en la pantalla, en castellano. */
const NOMBRES: Record<string, string> = {
  draft: "Borrador",
  sent: "Cotización enviada",
  "to approve": "Esperando aprobación en Odoo",
  purchase: "Confirmada",
  done: "Bloqueada",
  cancel: "Cancelada",
};

/**
 * Los únicos dos desde los que `button_confirm` hace algo.
 *
 * `to approve` queda afuera a propósito: ahí Odoo pide `button_approve`, que es
 * una aprobación de otra persona y con otra responsabilidad. El SdG no la
 * suplanta.
 */
const CONFIRMABLES = new Set(["draft", "sent"]);

export interface EstadoDeOrden {
  /** Tal como lo devuelve Odoo, o `null` si la orden ya no está. */
  crudo: string | null;
  /** Para mostrar. */
  nombre: string;
  /** Si tiene sentido ofrecer el botón de confirmar. */
  sePuedeConfirmar: boolean;
  /** Si ya está confirmada (o más allá). */
  estaConfirmada: boolean;
}

export function leerEstado(crudo: string | null | undefined): EstadoDeOrden {
  if (!crudo) {
    /*
     * Sin estado la orden ya no está en Odoo —la borraron— o no se pudo
     * preguntar. En los dos casos no se ofrece confirmar: sobre algo que no
     * sabemos que existe, el botón sólo puede dar un error.
     */
    return {
      crudo: null,
      nombre: "No está en Odoo",
      sePuedeConfirmar: false,
      estaConfirmada: false,
    };
  }

  return {
    crudo,
    // Un estado que no conocemos se muestra tal cual y no se traduce a una
    // mentira: si Odoo agrega uno, se ve el nombre técnico y se nota.
    nombre: NOMBRES[crudo] ?? crudo,
    sePuedeConfirmar: CONFIRMABLES.has(crudo),
    estaConfirmada: crudo === "purchase" || crudo === "done",
  };
}
