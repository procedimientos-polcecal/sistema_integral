/**
 * El precio de un requerimiento, cuando lo cargó el encargado de compras.
 *
 * El circuito real del grupo es éste:
 *
 *   1. Maxi o Nico **aprueban la compra** y le informan al encargado de compras
 *      cuál fue su elección — hoy, marcando la casilla en la comparativa.
 *   2. El **encargado de compras** pasa el pedido de *para comprar* a *pedido*,
 *      y carga el proveedor y el precio en Gestión de compra.
 *
 * O sea que el dato que manda es el que carga el encargado, y **no hay
 * cotización elegida**: el sistema esperaba una y por eso la orden a Odoo no se
 * generaba nunca.
 *
 * ## Qué es "Costo + IVA"
 *
 * Es el **total de toda la cantidad, con IVA, sin el envío**. Medido contra los
 * datos reales: el RI 1912 tiene `costo_iva` 7.734,32 y su presupuesto es 6.392
 * × 1 con IVA 21% — exactamente 6.392 × 1,21. El envío va aparte, en su propio
 * campo, porque así lo separa `costosParaElPedido`.
 *
 * ## Por qué hay que dividir
 *
 * Una línea de orden en Odoo lleva el precio **neto** y el impuesto por
 * separado: Odoo calcula el IVA. Mandar el total con IVA como precio unitario
 * cobraría el IVA dos veces y la orden saldría un 21% más cara que lo aprobado.
 *
 * El envío **no** se grava, y no es una decisión nueva: es la fórmula que ya usa
 * la comparativa —`neto * (1 + IVA) − descuento + envío`—, donde el envío se
 * suma después del impuesto.
 *
 * ## El redondeo, dicho en voz alta
 *
 * `price_unit` en Odoo tiene **dos decimales** (`digits: [16, 2]`, consultado en
 * la base del grupo). Así que un precio unitario con más precisión lo redondea
 * Odoo igual, y hay totales que no se pueden reconstruir exactos: 11.190.300
 * repartido en 30.000 unidades da 308,2727… y con dos decimales el total se
 * corre unos pesos.
 *
 * No se esconde. Se devuelve `totalReconstruido` para que la pantalla pueda
 * mostrar lo aprobado y lo que va a decir la orden, y quien mira decida. Una
 * diferencia de centavos que aparece sola en Odoo tres semanas después es mucho
 * peor que una diferencia avisada.
 */

/** El IVA que se asume cuando el dato no viene de un presupuesto. */
export const IVA_POR_DEFECTO = 0.21;

export interface PrecioDelRequerimiento {
  /** Precio unitario **neto**, con los dos decimales que guarda Odoo. */
  precioUnitario: number;
  cantidad: number;
  /** El envío, sin IVA y sin gravar. */
  costoEnvio: number;
  /** Con qué IVA se hizo la cuenta, para poder mostrarlo. */
  iva: number;
  /** Lo que va a totalizar la orden en Odoo, envío incluido. */
  totalReconstruido: number;
  /** Cuánto se corre de lo aprobado por el redondeo. Cero casi siempre. */
  diferencia: number;
}

export type ResultadoDelPrecio =
  | { ok: true; precio: PrecioDelRequerimiento }
  | { ok: false; motivo: string };

/**
 * Saca el precio unitario neto del "Costo + IVA" que cargó el encargado.
 *
 * Devuelve un motivo en vez de un número cuando no se puede: un precio
 * inventado en una orden de compra es peor que una orden que no se creó.
 */
export function precioDesdeElRequerimiento({
  costoIva,
  costoEnvio,
  cantidad,
  iva = IVA_POR_DEFECTO,
}: {
  costoIva: number | null;
  costoEnvio: number | null;
  cantidad: number | null;
  iva?: number;
}): ResultadoDelPrecio {
  if (costoIva === null || costoIva <= 0) {
    return { ok: false, motivo: "El requerimiento no tiene cargado el costo + IVA." };
  }

  /*
   * Sin cantidad se asume 1, y el costo pasa a ser el precio de la unidad. No
   * se rechaza: hay requerimientos de un servicio o de un trabajo donde la
   * cantidad no significa nada, y el importe igual es correcto.
   */
  const unidades = cantidad !== null && cantidad > 0 ? cantidad : 1;

  const neto = costoIva / (1 + iva);
  const envio = costoEnvio ?? 0;

  // Dos decimales porque es lo que Odoo guarda: mandar más precisión es dejar
  // que la redondee él y no saber con qué se quedó.
  const precioUnitario = redondear(neto / unidades, 2);
  const totalReconstruido = redondear(precioUnitario * unidades * (1 + iva) + envio, 2);

  return {
    ok: true,
    precio: {
      precioUnitario,
      cantidad: unidades,
      costoEnvio: envio,
      iva,
      totalReconstruido,
      diferencia: redondear(totalReconstruido - (costoIva + envio), 2),
    },
  };
}

function redondear(valor: number, decimales: number): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}
