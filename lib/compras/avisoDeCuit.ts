/**
 * Avisar que al proveedor le falta el CUIT, en el momento en que se lo va a
 * necesitar y no cuando ya es tarde.
 *
 * ## Por qué hace falta si el circuito ya lo dice
 *
 * Porque lo dice al final. `armarOrdenes()` frena con «sin cuit» —y el mensaje
 * está bien— pero recién al generar la orden de compra, o sea después de pedir
 * presupuestos, cargarlos, armar la comparativa y aprobarla. Medido el
 * 23/11/2026: de los 45 proveedores cotizados en 180 días que no llegan a una
 * orden, **40 no tienen CUIT**. Todo ese trabajo ya estaba hecho cuando apareció
 * el cartel.
 *
 * El padrón tiene **267 proveedores sin CUIT de 484** (26/11/2026, después de
 * cargar los 50 del archivo que completó administración), así que no es un caso
 * raro: es uno de cada dos.
 *
 * ## Por qué un CUIT inválido entra en el mismo aviso
 *
 * Porque el que lo lee tiene que hacer lo mismo —ir a la ficha y arreglarlo— y
 * el resultado de no hacerlo es idéntico: Odoo no reconoce al proveedor. Lo que
 * cambia es la frase, porque buscar un dato que falta y corregir uno que está
 * mal tipeado no se buscan en el mismo lugar.
 *
 * ## Lo que esto NO hace
 *
 * No bloquea nada. Se puede cargar un presupuesto de un proveedor sin CUIT y se
 * puede elegirlo: a veces se cotiza para comparar y la compra termina en otro.
 * El freno sigue estando donde el dato se vuelve imprescindible, que es la
 * orden. Esto sólo hace que no sorprenda.
 */

import { cuitEsValido, normalizarCuit } from "@/lib/core/cuit";

export interface ConCuit {
  /**
   * Opcional a propósito: el embed de la cotización lo declara así, y pedirlo
   * obligatorio haría que cada pantalla lo castee. Un `cuit` ausente y uno en
   * null son la misma cosa acá —no se sabe—, y las dos tienen que avisar.
   */
  cuit?: string | null;
}

/**
 * Qué decirle a quien está por usar a este proveedor, o `null` si está todo bien.
 *
 * El texto nombra la consecuencia —no se va a poder generar la orden— y no el
 * campo vacío: «falta el CUIT» no le dice a nadie por qué le importa.
 */
export function avisoDeCuit(proveedor: ConCuit | null | undefined): string | null {
  if (!proveedor) return null;

  const cuit = normalizarCuit(proveedor.cuit ?? null);
  if (!cuit) {
    return (
      "Este proveedor no tiene CUIT cargado, que es lo único con que se lo reconoce en Odoo: " +
      "sin eso no se va a poder generar la orden de compra. Cargáselo en su ficha."
    );
  }

  if (!cuitEsValido(cuit)) {
    return (
      `El CUIT cargado (${cuit}) no es válido: el dígito verificador no cierra, así que ` +
      "Odoo no va a reconocer al proveedor y la orden de compra no va a salir. Revisalo en su ficha."
    );
  }

  return null;
}

/** Si hay algo que avisar, para marcar una fila sin repetir el texto entero. */
export const leFaltaElCuit = (proveedor: ConCuit | null | undefined): boolean =>
  avisoDeCuit(proveedor) !== null;
