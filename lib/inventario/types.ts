/**
 * Lo que otros módulos necesitan saber de Inventario.
 *
 * Vive acá y no en la pantalla que lo usa para que el enlace entre Compras y el
 * pañol tenga una sola forma: hoy lo lee el detalle del requerimiento, mañana
 * puede leerlo un reporte.
 */

/** Una entrada al pañol registrada contra un requerimiento de Compras. */
export interface EntradaAlPanol {
  id: string;
  codigo: string | null;
  descripcion: string | null;
  cantidad: number;
  fecha: string | null;
}
