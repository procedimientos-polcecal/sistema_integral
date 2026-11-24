// Qué salidas del pañol pueden ser la de un repuesto de una OT, y qué dice un
// vínculo ya puesto. Funciones puras: quien trae las filas es la ruta.
//
// Se razona por fecha porque el kardex (`inventario_movimientos`) sólo crece
// por el final: medido sobre 5.136 filas, cero retrocesos de fecha. Pero
// `fecha` es un `date`, así que dentro de un mismo día no hay orden.

export interface SalidaDelPanol {
  id: string;
  articulo_id: string | null;
  fecha: string | null;
  cantidad: number;
  solicitante: string | null;
  sector_raw: string | null;
  equipo_raw: string | null;
  tipo: string;
}

const MS_POR_DIA = 86_400_000;

function diaDe(fecha: string): number {
  // `date` de Postgres: AAAA-MM-DD. En UTC para que el huso no mueva el día.
  return Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`) / MS_POR_DIA;
}

/**
 * Las salidas del mismo artículo desde que llegó la entrada, la más nueva
 * primero. Es una lista para que una persona elija, no una afirmación: por eso
 * se corta en `tope`. El máximo real de salidas posteriores a una entrada es
 * 454, y mostrarlas todas es no mostrar ninguna.
 *
 * Una fecha ausente deja afuera: sin ella no se puede decir «posterior». El
 * mismo día entra (`>=`), porque lo típico es comprar un repuesto para usarlo
 * ese día.
 */
export function salidasCandidatas(
  entrada: { articulo_id: string | null; fecha: string | null },
  salidas: SalidaDelPanol[],
  opciones: { dias?: number; tope?: number } = {},
): SalidaDelPanol[] {
  const { dias = 90, tope = 10 } = opciones;
  if (!entrada.articulo_id || !entrada.fecha) return [];
  const desde = diaDe(entrada.fecha);
  return salidas
    .filter((s) => {
      if (s.tipo !== "salida" || s.articulo_id !== entrada.articulo_id || !s.fecha) return false;
      const d = diaDe(s.fecha) - desde;
      return d >= 0 && d <= dias;
    })
    .sort((a, b) => (a.fecha! < b.fecha! ? 1 : a.fecha! > b.fecha! ? -1 : 0))
    .slice(0, tope);
}

export type Aplicacion =
  | { estado: "aplicado" }
  | { estado: "sin-justificar" }
  | { estado: "otra-pieza" };

/**
 * Qué dice el vínculo de un renglón. Sólo dice «aplicado» si la salida sigue
 * siendo del mismo artículo que el renglón: el vínculo es un id suelto y puede
 * quedar apuntando a otra pieza (le sacaron el artículo al renglón después de
 * declarar, o el kardex reusó una `sheets_fila`). Afirmar «aplicado» ahí
 * sería decir que se usó algo que no se usó.
 */
export function aplicacionDelRenglon(
  renglon: { articulo_id: string | null; movimiento_id: string | null },
  movimiento: SalidaDelPanol | null,
): Aplicacion {
  if (!renglon.movimiento_id) return { estado: "sin-justificar" };
  if (!movimiento || !renglon.articulo_id || movimiento.articulo_id !== renglon.articulo_id) {
    return { estado: "otra-pieza" };
  }
  return { estado: "aplicado" };
}
