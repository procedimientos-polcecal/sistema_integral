/**
 * Qué dejó de coincidir entre el requerimiento y la orden que está en Odoo.
 *
 * ## Por qué hace falta
 *
 * La orden se crea desde el SdG y **después se edita del otro lado**: en Odoo
 * cualquiera le cambia el precio, la cantidad o el producto. Hasta ahora la
 * ficha mostraba el número y una palabra de estado, así que una orden que ya no
 * decía lo que el requerimiento dice se veía exactamente igual que una intacta.
 *
 * Es la forma de error que este módulo persigue en todos lados: el dato dejó de
 * coincidir y nada avisa. Acá se puede avisar barato, porque los dos números
 * están a la vista en la misma pantalla.
 *
 * ## No es un error: es "mirá esto"
 *
 * Que difieran puede ser perfectamente correcto —el proveedor actualizó el
 * precio y contabilidad lo corrigió en la orden, que es donde corresponde—. Lo
 * que no puede pasar es que nadie se entere. Por eso devuelve diferencias para
 * mostrar, no un fallo.
 *
 * ## La tolerancia, y de dónde sale
 *
 * El total de Odoo **nunca** da exactamente igual al del SdG, y no por un error:
 * `price_unit` se manda con dos decimales, así que el unitario se redondea y el
 * subtotal arrastra ese redondeo multiplicado por la cantidad. Medido sobre los
 * 1.678 requerimientos con costo, el mayor descuadre por esa causa fue **$2,85
 * sobre $133.000** — está en `docs/COMPRAS-ESTADO.md`. En el RI 1933, el único
 * que llegó a tener orden, son **dos centavos**: 39.022,48 contra 39.022,50.
 *
 * La tolerancia va cómodamente arriba de eso y además es relativa, porque el
 * redondeo escala con el monto. Un precio cambiado a mano mueve el total mucho
 * más que un milésimo, así que no se pierde nada por ser generoso acá: lo caro
 * es un cartel que salta siempre y la gente aprende a ignorar.
 */

import { monedaExacta } from "./constants";

/** Un milésimo del total, con un piso de $10 para los montos chicos. */
const TOLERANCIA_RELATIVA = 0.001;
const TOLERANCIA_MINIMA = 10;

export interface Diferencia {
  campo: string;
  /** Lo que dice el requerimiento en el SdG. */
  enElSdg: string;
  /** Lo que dice la orden en Odoo. */
  enOdoo: string;
}

export interface LoQueDiceElRequerimiento {
  /** El costo con IVA que cargó Compras, de la compra **entera**. */
  costoConIva: number | null;
  cantidad: number | null;
}

export interface LoQueDiceLaOrden {
  /** La suma de los totales de todas las órdenes del requerimiento. */
  total: number;
  /** La suma de las cantidades de todas sus líneas. */
  cantidad: number;
}

/**
 * Las diferencias que vale la pena mostrar, o una lista vacía.
 *
 * Se compara contra la suma de **todas** las órdenes del requerimiento y no
 * contra cada una: un pedido que pagan las dos empresas son dos órdenes del 50%,
 * y comparar una sola contra el costo entero daría una diferencia del 50% en
 * cada ficha compartida. Eso sería un cartel permanente y falso.
 */
export function diferenciasDeLaOrden(
  ri: LoQueDiceElRequerimiento,
  odoo: LoQueDiceLaOrden
): Diferencia[] {
  const diferencias: Diferencia[] = [];

  if (ri.costoConIva !== null && ri.costoConIva > 0) {
    const tolerancia = Math.max(TOLERANCIA_MINIMA, odoo.total * TOLERANCIA_RELATIVA);
    if (Math.abs(ri.costoConIva - odoo.total) > tolerancia) {
      diferencias.push({
        campo: "El total",
        enElSdg: monedaExacta(ri.costoConIva),
        enOdoo: monedaExacta(odoo.total),
      });
    }
  }

  /*
   * La cantidad se compara entera y sin tolerancia: es un número que alguien
   * escribió, no un cálculo. La excepción conocida —un pedido AMBAS de cantidad
   * impar, que reparte 2,5 y 2,5— suma igual, así que no dispara.
   */
  if (ri.cantidad !== null && ri.cantidad > 0 && ri.cantidad !== odoo.cantidad) {
    diferencias.push({
      campo: "La cantidad",
      enElSdg: numero(ri.cantidad),
      enOdoo: numero(odoo.cantidad),
    });
  }

  return diferencias;
}

function numero(n: number): string {
  return n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
}
