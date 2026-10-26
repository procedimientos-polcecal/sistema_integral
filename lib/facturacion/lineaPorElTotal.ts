/**
 * La línea de una factura cuyo detalle no se pudo leer.
 *
 * ## Por qué existe
 *
 * Cuando el lector no saca el detalle del PDF, el buzón no guardaba **ninguna**
 * fila, y el borrador de Odoo se armaba con una línea por el total inventada en
 * el momento del push. Esa línea nunca existía en la base, así que la pantalla
 * mostraba "Líneas de factura 0" y **no había nada a lo que ponerle producto,
 * cuenta ni distribución analítica** — que es justo lo que hay que elegir para
 * que el asiento quede imputado donde va.
 *
 * Ahora esa línea es una fila de verdad. No cambia lo que llega a Odoo cuando
 * nadie la toca; cambia que se la puede tocar.
 *
 * ## Guarda el total, no el neto
 *
 * Es lo que dice el papel, y es lo que la pantalla tiene que mostrar. El neto
 * lo calcula el armador del borrador, porque **depende de algo que acá no se
 * sabe**: si la empresa tiene configurado el IVA Compras del 21%. Guardar un
 * neto calculado de este lado sería fijar a la hora del alta una cuenta que se
 * resuelve a la hora del push, y en una Factura A eso son 21 puntos de
 * diferencia.
 */

import { nombreDelComprobante } from "./comprobante";
import type { LineaDeFactura, LineaNueva } from "./lineas";

/** Lo mínimo que hace falta para nombrar y valorizar la línea. */
export interface CabeceraDeLaFactura {
  tipo_comprobante: number | null;
  punto_venta: number | null;
  numero: number | null;
  importe_total: number | null;
}

/**
 * Devuelve la única línea, o `null` si no hay un total del que hacerla.
 *
 * Sin importe no se inventa una línea en cero: una fila que dice que la factura
 * vale nada es peor que no tener fila, porque se puede empujar a Odoo sin que
 * nada avise.
 */
export function lineaPorElTotal(factura: CabeceraDeLaFactura): LineaNueva | null {
  const total = Number(factura.importe_total ?? 0);
  if (!Number.isFinite(total) || total === 0) return null;

  return {
    orden: 0,
    descripcion: nombreDelComprobante({
      tipoComprobante: factura.tipo_comprobante,
      puntoVenta: factura.punto_venta,
      numero: factura.numero,
    }),
    cantidad: 1,
    precio_unitario: total,
    total,
    odoo_product_id: null,
    odoo_product_nombre: null,
    odoo_account_id: null,
    odoo_account_nombre: null,
    analitica: null,
    analitica_detalle: null,
    producto_origen: null,
  };
}

/** Un centavo por línea, el mismo criterio que usan el push y el posteo. */
const MARGEN_POR_LINEA = 0.01;

/**
 * Si una única línea guardada **es** la del total.
 *
 * Es lo que distingue la línea de esta función de un detalle de una sola fila
 * leído del PDF. Las dos se ven igual en la tabla; lo que las separa es que
 * ésta vale exactamente lo que vale la factura.
 */
export function esLaLineaDelTotal(
  lineas: readonly LineaDeFactura[],
  importeTotal: number | null
): boolean {
  if (lineas.length !== 1) return false;
  const total = Math.abs(Number(importeTotal ?? 0));
  if (!total) return false;
  return Math.abs(Number(lineas[0].total ?? 0) - total) <= MARGEN_POR_LINEA;
}

/**
 * Qué líneas se le pasan al armador del borrador.
 *
 * Antes la regla vivía suelta en `pushFactura` y era `detalle_leido ===
 * "cuadra"`, que dejaba afuera la línea del total por ser de otra categoría.
 * Acá están los tres casos juntos, que es lo que permite probarlos:
 *
 * - **`cuadra`**: el detalle leído suma el comprobante. Va entero, como siempre.
 * - **una sola línea por el total**: la de esta función. Va, y con ella el
 *   producto, la cuenta y la analítica que alguien le puso. Es el caso nuevo.
 * - **`no cuadra`**: hay detalle leído pero no suma. **No va**, y eso no cambió:
 *   mandarlo armaría un borrador por un importe que no es el de la factura, y
 *   alguien tendría que descubrirlo a mano. El armador cae a su línea por el
 *   total, igual que hoy.
 */
export function lineasParaElBorrador(
  detalleLeido: string | null,
  lineas: readonly LineaDeFactura[],
  importeTotal: number | null
): LineaDeFactura[] {
  if (detalleLeido === "cuadra") return [...lineas];
  if (esLaLineaDelTotal(lineas, importeTotal)) return [...lineas];
  return [];
}
