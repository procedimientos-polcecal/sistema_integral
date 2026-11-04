import { esFechaIso, hoyEnArgentina } from "@/lib/core/fechas";

/**
 * El rango de días que pidió el navegador, siempre usable.
 *
 * Lo que vale la pena saber son los dos valores por defecto, porque los dos
 * estuvieron mal antes:
 *
 * - **Hasta** es hoy **en Argentina**, no `new Date()` recortado. Vercel corre
 *   en UTC: después de las 21:00 de acá, la segunda cuenta ya devuelve mañana.
 *   Es exactamente el error que una vez creó 68 filas de `calculos_diarios`
 *   marcando ausente a toda la planta para un día que no había empezado.
 * - **Desde** es el primero de ese mismo mes, por la misma razón: sacarlo de
 *   un `Date` en UTC cambia de mes un día antes.
 *
 * Una fecha mal escrita no devuelve error: quien abre la pantalla quiere ver
 * el mes, no un cartel. Se cae al valor por defecto, que es lo que esperaría
 * cualquiera.
 */
export function rangoPedido(params: URLSearchParams, instante?: Date): { desde: string; hasta: string } {
  const hoy = hoyEnArgentina(instante);
  const pedidoDesde = params.get("desde");
  const pedidoHasta = params.get("hasta");
  return {
    desde: esFechaIso(pedidoDesde) ? pedidoDesde : `${hoy.slice(0, 7)}-01`,
    hasta: esFechaIso(pedidoHasta) ? pedidoHasta : hoy,
  };
}
