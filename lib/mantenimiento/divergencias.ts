/**
 * Las divergencias del contraste, listas para guardar.
 *
 * ── POR QUÉ ESTO EXISTE ─────────────────────────────────────────────────────
 *
 * `contrastar-ot.mts` sabe encontrar una divergencia desde el 21/10/2026, pero
 * es un script que hay que acordarse de correr. Las tres que aparecieron —la OT
 * 2845 con la fecha corrida, las ocho con el ESTADO en blanco del 29/10, el
 * registro que se perdía porque el PATCH no anotaba el pendiente— las encontró
 * **una persona mirando**. Lo que decide si un problema se encuentra no puede
 * ser que alguien se acuerde.
 *
 * Así que el contraste pasa a correr dentro de la sincronización de órdenes,
 * que ya lee la planilla entera: ahí no cuesta ninguna lectura de Google de
 * más. Lo que esta función decide es qué de ese resultado se guarda.
 *
 * ── SE GUARDAN LAS DIVERGENCIAS Y NADA MÁS ──────────────────────────────────
 *
 * `contrastar` devuelve cuatro cosas y tres no se guardan, a propósito. Lo
 * difícil de esto nunca fue encontrar diferencias sino **no sonar por lo que no
 * importa**, y las otras tres suenan por lo que no importa:
 *
 *   - `enLaCola`: la orden tiene un pendiente anotado. El sistema sabe algo que
 *     la planilla todavía no, y eso es el estado normal de una OT recién
 *     registrada. Se resuelve solo.
 *   - `soloEnLaPlanilla`: el contraste corre **antes** de importar, así que
 *     toda fila nueva de la planilla cae acá. Son justo las que la corrida que
 *     sigue va a traer.
 *   - `soloEnElSistema`: una OT creada hace un rato cuya fila del master
 *     todavía no llegó por `IMPORTRANGE`. Indistinguible de un alta que falló
 *     de verdad hasta que pasa el tiempo, y eso no se puede decidir en una
 *     corrida.
 *
 * Un aviso que suena todos los días por algo normal termina en que alguien
 * apaga las notificaciones; de eso ya hay medida en este repo —de 13 personas,
 * las dos que probaron las notificaciones en serio tenían los 13 avisos
 * descartados—. Empieza callado y se le suma cuando haya una razón medida.
 */

import type { Contraste, Divergencia } from "./contraste";

/** Una fila de `mantenimiento_divergencias`. */
export interface FilaDeDivergencia {
  ot_number: number;
  campo: string;
  en_el_sistema: string;
  en_la_planilla: string;
}

/**
 * Cuántas filas como máximo se guardan de una corrida.
 *
 * No es una optimización: es el mismo freno que `borradoDeEspejo`, por la misma
 * razón. Si algo se rompe del lado de la planilla —una fórmula que se cae, una
 * pestaña que vuelve vacía— el contraste encontraría una divergencia por cada
 * orden, y escribir dos mil filas para decir «se cayó la planilla» es ruido
 * caro. Pasado el tope se guarda el tope y el resto se cuenta aparte: el aviso
 * dice igual que hay que mirar, que es lo único que tenía que lograr.
 */
export const TOPE_DE_DIVERGENCIAS = 200;

export interface LoQueSeGuarda {
  filas: FilaDeDivergencia[];
  /** Cuántas había en total, que puede ser más que las guardadas. */
  total: number;
  /** Cuántas quedaron afuera por el tope. */
  recortadas: number;
}

export function loQueSeGuardaDelContraste(contraste: Contraste): LoQueSeGuarda {
  const todas = contraste.divergencias;
  const filas = todas.slice(0, TOPE_DE_DIVERGENCIAS).map(deUna);
  return {
    filas,
    total: todas.length,
    recortadas: Math.max(0, todas.length - filas.length),
  };
}

/**
 * Una divergencia como fila.
 *
 * Los dos lados se guardan **como los imprime el contraste**, incluido el
 * "(vacío)": quien lea la tabla tiene que poder distinguir «la celda dice
 * cero» de «la celda no dice nada», que es justo la diferencia que hizo falta
 * el 29/10 para ver las ocho órdenes sin estado.
 */
function deUna(d: Divergencia): FilaDeDivergencia {
  return {
    ot_number: d.ot_number,
    campo: d.campo,
    en_el_sistema: d.enElSistema,
    en_la_planilla: d.enLaPlanilla,
  };
}
