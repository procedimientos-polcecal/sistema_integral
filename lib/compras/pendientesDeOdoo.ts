import { loQueFaltaParaLaOrden, type RequerimientoParaLaOrden } from "./ordenesDesdeLaPlanilla";

/**
 * Los pedidos que quedaron sin su orden en Odoo, y qué pasa si se mandan.
 *
 * ## De dónde sale esta pila
 *
 * El disparador de la orden vivía en la ruta de la app y el estado llega a
 * PEDIDO por la sincronización, así que durante semanas no se creó ninguna
 * —ver `ordenesDesdeLaPlanilla.ts`—. Arreglado el disparador, quedó el pasado:
 * medido el 02/10/2026, **119 requerimientos en PEDIDO con proveedor, costo y
 * empresa, y sin orden**.
 *
 * El arreglo del disparador mira transiciones, así que no los toca a propósito.
 * Mandarlos es una decisión de una persona, y esto es lo que esa persona
 * aprieta.
 *
 * ## Lo que hay que ver antes de apretar
 *
 * No son 119 órdenes: **son 177**, porque 58 los pagan las dos empresas y ésos
 * generan una orden en cada contabilidad. Suman **$103.890.769**. Y el más
 * viejo es de septiembre de 2025.
 *
 * Por eso `resumirPendientes` existe y la pantalla lo muestra antes del botón.
 * Escribir 177 órdenes en la contabilidad real del grupo no puede ser el
 * resultado de un clic a ciegas.
 *
 * ## Y un detalle que no es obvio
 *
 * La orden se crea con **`date_order` de hoy**, no con la fecha del pedido
 * (`fechaParaOdoo(contexto.ahora)` en `ordenDeCompra.ts`). Mandar un pedido de
 * 2025 le pone fecha de hoy en Odoo. Por eso hay un corte por fecha: quien
 * manda decide desde cuándo, en vez de arrastrar un año de historia.
 *
 * ## Sólo PEDIDO
 *
 * Los 1.559 en RECIBIDO —2.146 órdenes, $911 millones— quedan afuera. Es otra
 * decisión y de otro tamaño: ahí la mercadería ya llegó, y si la factura ya se
 * cargó a mano la orden no le ahorra trabajo a nadie.
 */

/** Lo que hace falta de cada candidato para listarlo y resumirlo. */
export interface PendienteDeOdoo extends RequerimientoParaLaOrden {
  id: string;
  /** La fecha del requerimiento, para el corte. */
  fecha: string | null;
  descripcion: string | null;
}

export interface ResumenDePendientes {
  requerimientos: number;
  /** Las órdenes que se van a crear: los AMBAS cuentan por dos. */
  ordenes: number;
  /** La suma de los costos con IVA. */
  total: number;
  masViejo: string | null;
  masNuevo: string | null;
}

/**
 * Cuántas órdenes genera un requerimiento. Dos cuando lo pagan las dos
 * empresas, porque cada contabilidad lleva la suya.
 */
export const ordenesQueGenera = (r: { paga_ambas: boolean }): number => (r.paga_ambas ? 2 : 1);

/**
 * Los que se pueden mandar, del más nuevo al más viejo.
 *
 * **Del más nuevo primero** y no al revés: si quien manda corta a la mitad o
 * algo falla, lo que quedó hecho es lo que más sirve —el pedido reciente cuya
 * factura todavía no llegó—. Un pedido de hace un año ya se facturó a mano.
 *
 * `desde` es un corte por fecha del requerimiento, inclusive. Sin corte entran
 * todos.
 */
export function losPendientesDeOdoo(
  candidatos: PendienteDeOdoo[],
  yaConOrden: Set<string>,
  desde?: string | null
): PendienteDeOdoo[] {
  return candidatos
    .filter((r) => r.estado_compra === "PEDIDO")
    .filter((r) => !yaConOrden.has(r.id))
    .filter((r) => loQueFaltaParaLaOrden(r) === null)
    .filter((r) => !desde || (r.fecha !== null && r.fecha.slice(0, 10) >= desde))
    .sort((a, b) => String(b.fecha ?? "").localeCompare(String(a.fecha ?? "")));
}

/** Lo que la pantalla muestra antes del botón. */
export function resumirPendientes(pendientes: PendienteDeOdoo[]): ResumenDePendientes {
  const fechas = pendientes
    .map((r) => r.fecha)
    .filter((f): f is string => Boolean(f))
    .map((f) => f.slice(0, 10))
    .sort();

  return {
    requerimientos: pendientes.length,
    ordenes: pendientes.reduce((a, r) => a + ordenesQueGenera(r), 0),
    total: pendientes.reduce((a, r) => a + (r.costo_iva ?? 0), 0),
    masViejo: fechas[0] ?? null,
    masNuevo: fechas[fechas.length - 1] ?? null,
  };
}

/**
 * Cuántos requerimientos entran en una tanda.
 *
 * No es un número de rendimiento: es el reloj. Cada push son varios segundos
 * contra Odoo Online y un requerimiento AMBAS son dos órdenes, así que con
 * cinco el peor caso son diez creaciones — que entran holgadas en los 60
 * segundos de la función. El resto lo pide la pantalla en la tanda siguiente,
 * mostrando el avance.
 *
 * Que sean varias tandas tiene además una ventaja: se puede parar en el medio y
 * lo hecho queda hecho, porque cada orden se vincula apenas se crea.
 */
export const POR_TANDA = 5;
