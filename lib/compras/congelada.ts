/**
 * ¿La comparativa de un requerimiento está congelada?
 *
 * Congelada significa **no se toca más**: no se cargan presupuestos, no se
 * borran y no se relee la planilla. La razón es sana —una vez decidida la
 * compra, cambiar la comparativa reescribe la historia de una decisión ya
 * tomada— pero la pregunta estaba mal hecha.
 *
 * Se preguntaba sólo por el estado, y hay **35 requerimientos** en APROBADO sin
 * proveedor ni presupuesto elegido: ese estado vino de la columna de la planilla
 * y no de que alguien eligiera en el sistema. Con la pregunta vieja quedaban en
 * un pozo: la pantalla escondía el botón de traer la planilla, y las cuatro
 * rutas contestaban "La comparativa quedó congelada al aprobarse la compra".
 * Congelada por una compra que nadie aprobó.
 *
 * La pregunta correcta es si **hay una decisión que proteger**. Si no hay nada
 * elegido y el requerimiento no tiene proveedor, no hay nada que congelar.
 *
 * Vive acá y no en cada ruta porque estaba escrita cinco veces —tres rutas, la
 * pantalla y el guard de aprobación— y cada copia preguntaba un poco distinto.
 * Es la misma lección que `puedeAprobarLaCompra`: cuando la regla se copia, una
 * de las copias se queda atrás. Esta vez la que se quedó atrás fueron las rutas,
 * y el síntoma fue un botón que aparecía y no funcionaba.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Estados en los que el sistema considera que la compra ya se decidió. */
export const ESTADOS_DECIDIDOS = ["APROBADO", "PEDIDO", "RECIBIDO"];

export function comparativaCongelada({
  estadoCompra,
  proveedorId,
  hayPresupuestoElegido,
}: {
  estadoCompra: string;
  /** El proveedor del requerimiento. Los RI viejos de la planilla lo tienen. */
  proveedorId: string | null;
  hayPresupuestoElegido: boolean;
}): boolean {
  if (!ESTADOS_DECIDIDOS.includes(estadoCompra)) return false;

  // El estado dice que se decidió; sólo está congelada si de verdad hay algo.
  return hayPresupuestoElegido || proveedorId !== null;
}

/**
 * ¿Este requerimiento ya tiene un presupuesto elegido?
 *
 * Es la mitad de la pregunta de `comparativaCongelada`; la otra mitad es el
 * proveedor del requerimiento. Cuenta en la base en vez de traer las filas:
 * lo único que hace falta saber es si hay alguna.
 *
 * Vive acá y no en cada ruta por la misma razón que la regla: estaba copiada en
 * las tres y una copia es una copia que se queda atrás.
 */
export async function tienePresupuestoElegido(
  admin: SupabaseClient,
  requerimientoId: string
): Promise<boolean> {
  const { count } = await admin
    .from("compras_cotizaciones")
    .select("id", { count: "exact", head: true })
    .eq("requerimiento_id", requerimientoId)
    .eq("elegida", true);

  return (count ?? 0) > 0;
}
