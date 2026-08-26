import type { EstadoCompra } from "./types";

/**
 * Devolver un pedido a comparativa.
 *
 * Es lo que hace quien aprueba cuando lo que le llegó no alcanza para decidir:
 * un presupuesto vencido, uno solo cuando hacen falta tres, un flete sin
 * cotizar. No es lo mismo que ponerlo en espera —eso es una decisión que toma
 * para sí mismo—: devolver le manda trabajo a otra persona.
 *
 * Por eso el motivo es obligatorio. Sin él, Compras recibe el pedido de vuelta
 * sin saber qué corregir, y lo más probable es que vuelva igual que como se fue.
 */
export function esDevolucionAComparativa(
  desde: EstadoCompra | null | undefined,
  hacia: EstadoCompra | null | undefined
): boolean {
  // Sólo el regreso desde la bandeja cuenta como devolución. Llegar a
  // comparativa desde cualquier otro lado —al aprobar el requerimiento, por
  // ejemplo— no es devolverle nada a nadie.
  return desde === "PARA_COMPRAR" && hacia === "EN_COMPARATIVA";
}

/** Si a esta devolución le falta el motivo que la explique. */
export function faltaElMotivo(
  desde: EstadoCompra | null | undefined,
  hacia: EstadoCompra | null | undefined,
  nota: unknown
): boolean {
  if (!esDevolucionAComparativa(desde, hacia)) return false;
  return !String(nota ?? "").trim();
}
