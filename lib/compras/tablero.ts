import { COLUMNAS_TABLERO } from "./constants";
import type { EstadoCompra } from "./types";

/**
 * Los indicadores del tablero.
 *
 * El tablero no muestra el trabajo sino su tamaño: una cifra por etapa, y el
 * detalle a un clic en una pantalla que ya existe. No hay pantallas nuevas por
 * etapa a propósito —el listado de requerimientos ya sabe filtrar, y "Para
 * comprar" ya tiene la suya—.
 */

/** Color de la cifra. Acompaña al del chip del estado, sin el fondo. */
const ACENTO: Record<EstadoCompra, string | undefined> = {
  SIN_INICIAR: undefined,
  EN_COMPARATIVA: "text-blue-600",
  PARA_COMPRAR: "text-amber-600",
  APROBADO: "text-teal-600",
  PEDIDO: "text-indigo-600",
  RECIBIDO: "text-green-600",
  DENEGADO: "text-red-600",
};

/**
 * A dónde lleva tocar una etapa.
 *
 * `PARA_COMPRAR` va a la bandeja en vez de al listado: ya es la pantalla de ese
 * estado y lo hace mejor que una tabla, porque despliega la comparativa entera
 * y elegir un presupuesto ES aprobar la compra.
 *
 * Pero la bandeja es sólo de quienes aprueban —a los demás los rebota a
 * /compras—, así que para el resto el indicador lleva al listado filtrado. Un
 * botón que devuelve al lugar de donde saliste se lee como que está roto.
 */
export function destinoDeLaEtapa(estado: EstadoCompra, puedeAprobar: boolean): string {
  if (estado === "PARA_COMPRAR" && puedeAprobar) return "/compras/para-aprobar";
  return `/compras/requerimientos?estado_compra=${estado}`;
}

export interface Indicador {
  estado: EstadoCompra;
  cantidad: number;
  monto: number;
  href: string;
  acento?: string;
}

/**
 * Arma los cinco indicadores en el orden del circuito.
 *
 * El resumen viene de la base agrupado por estado, y una etapa vacía no
 * aparece ahí: se completa en cero. Sin esto, una columna sin trabajo
 * desaparecería de la pantalla, que es justo lo contrario de lo que hay que
 * mostrar —"no hay nada acá" es información—.
 */
export function armarIndicadores(
  resumen: { estado_compra: EstadoCompra; cantidad: number; monto: number }[],
  puedeAprobar: boolean
): Indicador[] {
  const porEstado = new Map(resumen.map((r) => [r.estado_compra, r]));

  return COLUMNAS_TABLERO.map((estado) => {
    const fila = porEstado.get(estado);
    return {
      estado,
      cantidad: fila?.cantidad ?? 0,
      monto: fila?.monto ?? 0,
      href: destinoDeLaEtapa(estado, puedeAprobar),
      acento: ACENTO[estado],
    };
  });
}
