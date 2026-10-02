/**
 * Qué requerimientos pasaron a PEDIDO en esta sincronización y hay que mandar a
 * Odoo.
 *
 * ## Por qué existe: el disparador estaba donde el flujo no pasa
 *
 * La orden de compra en Odoo se creaba desde la ruta `PATCH` del requerimiento,
 * al pasar el estado a PEDIDO desde el sistema. En la práctica **eso no pasa
 * nunca**. Medido el 02/10/2026 sobre el historial completo:
 *
 * - Desde que el push existe (11/09) hubo **66 transiciones a PEDIDO** y
 *   **ninguna** generó orden.
 * - Las 66 tienen `usuario_nombre` en null: las registró el trigger
 *   `compras_requerimientos_log_estado`, que anota **todo** cambio de estado,
 *   venga de la app o de la planilla.
 * - 65 de las 66 **no tienen `costo_iva`**, y la ruta de la app rechaza esa
 *   transición con un 409 antes de tocar nada.
 * - Ninguna tiene `fecha_pedido`, que esa ruta escribe desde el 19/08.
 *
 * O sea que el estado llega a PEDIDO **por la sincronización con la planilla**,
 * que escribe `estado_compra` directo y no sabe nada de Odoo. Las únicas dos
 * órdenes que existen son de la prueba del 11/09.
 *
 * ## Qué hace esto, y qué no
 *
 * Decide a cuáles se les crea la orden. **Es pura a propósito**: la regla de
 * "esto se manda a la contabilidad real del grupo" no puede vivir dentro de un
 * bucle de 2.000 filas sin poder probarla.
 *
 * Lo que **no** hace es tocar el pasado. Mira transiciones, no estados, así que
 * los 119 requerimientos que hoy están en PEDIDO con todos los datos y sin
 * orden **no se mandan solos**: aparecieron antes de que esto existiera y
 * mandarlos es una decisión de alguien, no de un cron.
 */

import type { EstadoCompra } from "./types";

/** Lo que hace falta saber de un requerimiento para decidir. */
export interface RequerimientoParaLaOrden {
  nro_ri: number;
  estado_compra: EstadoCompra | null;
  proveedor_id: string | null;
  costo_iva: number | null;
  empresa_id: string | null;
  paga_ambas: boolean;
}

export interface Reparto {
  /** Las que se mandan a Odoo en esta corrida. */
  aCrear: number[];
  /**
   * Pasaron a PEDIDO pero les falta algo para armar la orden. No es un fallo:
   * la planilla suele marcar PEDIDO antes de que se cargue el costo.
   */
  sinDatos: { nro_ri: number; falta: string }[];
  /**
   * Pasaron el tope de la corrida. **No se pierden**: quien llama les deja el
   * pendiente anotado, que es lo que las hace visibles y reintentables desde la
   * ficha.
   */
  postergadas: number[];
}

/**
 * Cuántas órdenes como mucho por corrida.
 *
 * Crear una orden **escribe en la contabilidad real del grupo**, así que una
 * edición masiva en la planilla no puede convertirse en doscientas órdenes sin
 * que nadie lo decida. El ritmo real son ~3 transiciones a PEDIDO por día —66
 * en tres semanas—, así que diez por corrida es muy holgado para lo normal y
 * corta lo anormal.
 *
 * El otro motivo es el reloj: cada push son varios segundos contra Odoo Online
 * y la sincronización corre dentro de una función con tiempo límite.
 */
export const TOPE_POR_CORRIDA = 10;

/** Qué le falta a un requerimiento para poder armarle la orden, o `null`. */
export function loQueFaltaParaLaOrden(r: RequerimientoParaLaOrden): string | null {
  const falta: string[] = [];

  if (!r.proveedor_id) falta.push("el proveedor");
  // Sin costo la orden saldría en cero, que es peor que no tenerla: queda una
  // orden en la contabilidad que parece real y no lo es.
  if (r.costo_iva === null || r.costo_iva <= 0) falta.push("el costo");
  // Sin empresa no se sabe a cuál de las dos contabilidades va.
  if (!r.empresa_id && !r.paga_ambas) falta.push("la empresa que paga");

  return falta.length ? falta.join(", ") : null;
}

/**
 * Las que **pasaron** a PEDIDO en esta corrida.
 *
 * Transición y no estado: comparar contra lo que había es lo que hace que esto
 * no mande el pasado. Un requerimiento que ya estaba en PEDIDO antes de la
 * sincronización no entra, aunque no tenga orden.
 */
export function lasQuePasaronAPedido(
  escritas: { nro_ri: number; estado_compra?: unknown }[],
  previas: Map<number, { estado_compra: EstadoCompra }>
): number[] {
  return escritas
    .filter(
      (f) =>
        f.estado_compra === "PEDIDO" && previas.get(f.nro_ri)?.estado_compra !== "PEDIDO"
    )
    .map((f) => f.nro_ri);
}

/**
 * Reparte los candidatos entre las que se mandan, las que no tienen con qué, y
 * las que quedan para la próxima.
 *
 * El orden importa: primero se descarta lo que no se puede armar y recién
 * después se aplica el tope. Al revés, diez requerimientos sin costo gastarían
 * el cupo de la corrida y dejarían afuera a los que sí se podían mandar.
 */
export function repartirLasOrdenes(
  candidatos: RequerimientoParaLaOrden[],
  tope: number = TOPE_POR_CORRIDA
): Reparto {
  const sinDatos: Reparto["sinDatos"] = [];
  const listos: number[] = [];

  for (const r of candidatos) {
    const falta = loQueFaltaParaLaOrden(r);
    if (falta) sinDatos.push({ nro_ri: r.nro_ri, falta });
    else listos.push(r.nro_ri);
  }

  // Los más viejos primero, que es como llegan de la planilla: si hay que
  // postergar a alguien, que sea al que recién entra y no al que espera hace
  // más tiempo.
  listos.sort((a, b) => a - b);

  return { aCrear: listos.slice(0, tope), sinDatos, postergadas: listos.slice(tope) };
}
