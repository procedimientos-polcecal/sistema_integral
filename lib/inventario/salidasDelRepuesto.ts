// Qué salidas del pañol pueden ser la de un repuesto de una OT, y qué dice un
// vínculo ya puesto. Funciones puras: quien trae las filas es la ruta.
//
// `inventario_movimientos.fecha` es un `date`, no un timestamp: dentro de un
// mismo día no hay orden. Por eso el mismo día cuenta como candidato, y por eso
// «día» se define en un solo lugar (`diaDe`) y lo usan la ventana y el orden.
// `tipo` toma sólo dos valores en producción: "salida" y "entrada".

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

/** Los días de la ventana por omisión, y el tope de filas que se ofrecen. */
export const DIAS_DE_LA_VENTANA = 90;
export const TOPE_DE_CANDIDATAS = 10;

/**
 * La ventana levantada: «todas las posteriores, sin corte de días». El tope
 * sigue valiendo — lo que se levanta es el plazo, no el número de filas.
 */
export const SIN_VENTANA = Number.POSITIVE_INFINITY;

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
 *
 * Dentro de un mismo día el orden es el de llegada de `salidas` (el sort es
 * estable y no hay con qué desempatar). Con más de `tope` salidas en un día,
 * cuáles sobreviven lo decide quien trae las filas: que las traiga en un orden
 * que tenga sentido (por ejemplo por id) es cosa suya.
 */
export function salidasCandidatas(
  entrada: { articulo_id: string | null; fecha: string | null },
  salidas: SalidaDelPanol[],
  opciones: { dias?: number; tope?: number } = {},
): SalidaDelPanol[] {
  const { dias = DIAS_DE_LA_VENTANA, tope = TOPE_DE_CANDIDATAS } = opciones;
  if (!entrada.articulo_id || !entrada.fecha) return [];
  const desde = diaDe(entrada.fecha);
  return salidas
    .filter((s) => {
      if (s.tipo !== "salida" || s.articulo_id !== entrada.articulo_id || !s.fecha) return false;
      const d = diaDe(s.fecha) - desde;
      return d >= 0 && d <= dias;
    })
    .sort((a, b) => diaDe(b.fecha!) - diaDe(a.fecha!))
    .slice(0, tope);
}

export type Aplicacion =
  | { estado: "aplicado" }
  | { estado: "sin-justificar" }
  | { estado: "otra-pieza" }
  // El único estado que habla de lo que NO se sabe: hay vínculo y no se pudo
  // leer la salida (`movimiento_id` puesto y `movimiento === null`). La causa
  // esperada es que quien mira no tenga Inventario —`inventario_movimientos`
  // está cerrada con `tiene_acceso_inventario()` y devuelve null sin error—,
  // no un movimiento borrado: un borrado deja `movimiento_id` en null por el
  // `on delete set null`, y eso es "sin-justificar". Decir "otra-pieza" ahí
  // afirmaría algo falso sobre un vínculo que puede estar perfecto.
  | { estado: "sin-ver" };

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
  if (!movimiento) return { estado: "sin-ver" };
  // Sin artículo en el renglón no hay pieza que comparar: null === null daría
  // "aplicado", y hoy ningún renglón (0 de 37) tiene artículo.
  if (!renglon.articulo_id || movimiento.articulo_id !== renglon.articulo_id) {
    return { estado: "otra-pieza" };
  }
  return { estado: "aplicado" };
}

/**
 * Los números de las órdenes que declararon una salida, sin repetir y de menor
 * a mayor. Son varias a propósito: el vínculo vive en el renglón de repuesto y
 * no en el movimiento, así que una entrega de 10 puede estar declarada por dos
 * órdenes y la ficha no puede mostrar una sola. Una orden con dos renglones que
 * apuntan a la misma salida cuenta una vez.
 */
export function ordenesQueDeclararon(
  movimientoId: string,
  renglones: { movimiento_id: string | null; ot_number: number | null }[],
): number[] {
  const numeros = new Set<number>();
  for (const r of renglones) {
    if (r.movimiento_id === movimientoId && r.ot_number != null) numeros.add(r.ot_number);
  }
  return [...numeros].sort((a, b) => a - b);
}

/**
 * Qué dicen los renglones de repuesto de una salida, mirado desde la salida.
 *
 * Reusa `aplicacionDelRenglon` para decidir cada renglón, así que la regla de
 * «sólo es aplicado si el artículo coincide» vive en un solo lugar. `sin-ver`
 * no puede darse acá —la salida está en la mano— y cuenta del lado de la pieza
 * que no se pudo confirmar, que es lo más cauto que se puede decir.
 *
 * `{ [], [] }` es «ningún renglón la declaró», o sea «sin justificar». Eso es
 * cierto sólo si quien llama pudo leer los renglones: si la lectura falló, lo
 * que corresponde es no llamar a esto y decir que no se pudo leer.
 */
export function lecturaDeLaSalida(
  salida: SalidaDelPanol,
  renglones: { articulo_id: string | null; movimiento_id: string | null; ot_number: number | null }[],
): { aplicadoA: number[]; otraPieza: number[] } {
  const delMismoArticulo: typeof renglones = [];
  const deOtraPieza: typeof renglones = [];
  for (const r of renglones) {
    if (r.movimiento_id !== salida.id) continue;
    (aplicacionDelRenglon(r, salida).estado === "aplicado" ? delMismoArticulo : deOtraPieza).push(r);
  }
  return {
    aplicadoA: ordenesQueDeclararon(salida.id, delMismoArticulo),
    otraPieza: ordenesQueDeclararon(salida.id, deOtraPieza),
  };
}

/** Una salida del pañol tal como la dibuja la ficha de un RI. */
export interface SalidaParaLaFicha {
  id: string;
  fecha: string | null;
  cantidad: number;
  solicitante: string | null;
  sector_raw: string | null;
  equipo_raw: string | null;
  /** Las órdenes que la declararon como suya, con su texto para mostrar. */
  aplicadoA: { ot_number: number; descripcion: string | null }[];
  /** Órdenes cuyo renglón la declaró pero es de otro artículo. */
  otraPieza: number[];
}

/**
 * Lo que la ficha sabe de las salidas, y hasta dónde lo sabe. Tres lecturas
 * porque «no hay» y «no se pudo leer» no pueden verse iguales:
 * - `completa`: se leyeron las salidas y quién las declaró.
 * - `sin-las-declaraciones`: hay salidas, pero no se pudo leer qué órdenes las
 *   declararon (típicamente, la migración de `movimiento_id` sin aplicar), así
 *   que no se puede decir «sin justificar».
 * - `fallida`: no se pudieron leer ni las salidas.
 */
export interface SalidasDeLaFicha {
  lectura: "completa" | "sin-las-declaraciones" | "fallida";
  salidas: SalidaParaLaFicha[];
}
