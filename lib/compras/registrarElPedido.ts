/**
 * Lo que hace falta al registrar el pedido, y qué se hace con la orden de Odoo.
 *
 * Son dos reglas chicas que viven acá y no en la ruta porque las comparten el
 * servidor y el modal: si cada lado la escribe por su cuenta, el botón se
 * habilita con un criterio y la API rechaza con otro.
 *
 * ## Por qué la fecha estimada se pide acá y no en la recepción
 *
 * Existía sólo en el formulario de recepción, o sea que se cargaba **cuando la
 * cosa ya había llegado**, que es justo cuando esa fecha no le sirve a nadie.
 * Medido el 30/10/2026: de los 356 RI que estaban en PEDIDO —los que alguien
 * está esperando— **7** tenían fecha estimada; de los 1.550 que la tienen,
 * casi todos ya estaban recibidos. Quien pregunta «¿cuándo llega?» es el que
 * no puede cerrar su OT sin el repuesto, y la respuesta tiene que existir
 * mientras todavía es una espera.
 */

import type { EstadoCompra } from "./types";

/**
 * Si falta la fecha estimada para poder pasar a PEDIDO.
 *
 * **Se exige sólo al entrar**, no en cada guardado que nombre a PEDIDO. La
 * diferencia no es cosmética: el formulario de recepción manda
 * `estado_compra: "PEDIDO"` cada vez que se guarda sin fecha de recepción, así
 * que exigirla siempre dejaría sin poder cargarse los RI que ya están en
 * PEDIDO desde antes —349 el día que esto se escribió, todos entrados por la
 * planilla—. Es la misma condición con la que se dispara la orden de Odoo.
 */
export function faltaLaFechaEstimada({
  estadoActual,
  nuevoEstado,
  fechaEstimada,
  vuelveDeLaEspera = false,
}: {
  estadoActual: EstadoCompra | string;
  nuevoEstado: string | undefined;
  /** La que quedaría guardada: la que viene en el cuerpo, o la que ya estaba. */
  fechaEstimada: string | null | undefined;
  /**
   * Si está saliendo de EN_ESPERA. Entonces no se exige nada, por la misma
   * razón que no se exigen el proveedor ni el costo: volver de la espera es
   * retomar donde estaba, y un pedido frenado seis meses quedaría atrapado
   * ahí adentro, que es justo lo que la espera viene a evitar.
   */
  vuelveDeLaEspera?: boolean;
}): boolean {
  if (nuevoEstado !== "PEDIDO") return false;
  if (estadoActual === "PEDIDO") return false;
  if (vuelveDeLaEspera) return false;
  return !fechaEstimada;
}

/**
 * Si este guardado tiene que crear la orden de compra en Odoo.
 *
 * `quiere` es lo que pidió quien apretó el botón. Vale `undefined` cuando el
 * cuerpo no lo dice —cualquier llamada que no sea el modal—, y ahí se crea,
 * que es lo que el sistema venía haciendo desde siempre. Sólo un `false`
 * explícito la saltea: destildar el casillero es una decisión, no un olvido.
 */
export function creaLaOrdenEnOdoo({
  estadoActual,
  nuevoEstado,
  quiere,
}: {
  estadoActual: EstadoCompra | string;
  nuevoEstado: string | undefined;
  quiere: unknown;
}): boolean {
  if (nuevoEstado !== "PEDIDO") return false;
  if (estadoActual === "PEDIDO") return false;
  return quiere !== false;
}

/**
 * Qué decirle a quien acaba de registrar el pedido sobre la orden de Odoo.
 *
 * Vive acá porque el listado tiraba a la basura las tres respuestas que la
 * ruta devuelve —el número de la orden, el motivo del fallo y el aviso de la
 * planilla—, así que la orden se creaba y nadie se enteraba, y cuando fallaba
 * sólo se veía entrando a la ficha de ese RI. Doce RI tenían `odoo_pendiente`
 * el día que esto se escribió.
 *
 * Devuelve `null` cuando no hay nada que decir, para que el llamador no tenga
 * que distinguir entre "no pasó nada" y "pasó y salió bien en silencio".
 */
export function avisoDelPedido(respuesta: {
  aviso_sheets?: string | null;
  aviso_odoo?: string | null;
  orden_odoo?: string[] | null;
}): string | null {
  const partes: string[] = [];
  if (respuesta.orden_odoo?.length) {
    partes.push(`Orden de compra creada en Odoo: ${respuesta.orden_odoo.join(", ")}.`);
  }
  // Los dos fallos se dicen juntos y no se pisan: son dos destinos distintos y
  // que uno ande no vuelve menos grave al otro.
  if (respuesta.aviso_odoo) partes.push(respuesta.aviso_odoo);
  if (respuesta.aviso_sheets) partes.push(respuesta.aviso_sheets);
  return partes.length ? partes.join(" ") : null;
}
