import { instanteDe } from "./evento";

export type Divergencia = "borrado" | "movido";

/** Argentina no tiene horario de verano: el desfase es fijo. */
const DESFASE_ARGENTINA_MS = 3 * 60 * 60_000;

/** El instante en UTC; una cadena sin zona es hora de pared de Argentina (-03:00). */
function instanteUTC(texto: string): number | null {
  const i = instanteDe(texto);
  if (!i) return null;
  return i.conZona ? i.ms : i.ms + DESFASE_ARGENTINA_MS;
}

/**
 * ¿Es el mismo momento? Por instante, no por texto: `...-03:00` y `...Z`
 * pueden ser la misma hora.
 *
 * Una cadena sin zona se lee como hora de pared de Argentina, y no hace falta
 * que sea una convención de quien llama: es lo que el SdG escribe.
 * `horarioDeLaOT` produce `2026-11-03T08:00:00`, el cliente de Calendar lo manda
 * así con el `timeZone` aparte, y Google lo devuelve como
 * `2026-11-03T08:00:00-03:00`. Comparado como texto, cada eco de una escritura
 * propia saldría «movido». El `timeZone` va aparte porque nueve de los catorce
 * calendarios del dominio están en UTC: por eso `horarioDeLaOT` no puede emitir
 * el desfase.
 *
 * Lo que no es una fecha-hora (el `"2026-11-03"` que devuelve el cliente cuando
 * alguien convierte el evento en uno de día completo desde Google) no tiene
 * instante y no es igual a nada: da «movido». **Es a propósito y no un bug**: es
 * un cambio real, el evento dejó de tener la hora que el SdG le puso.
 */
function mismoMomento(a: string, b: string): boolean {
  const x = instanteUTC(a);
  const y = instanteUTC(b);
  if (x === null || y === null) return false;
  return x === y;
}

/**
 * Qué cambió del otro lado, comparando contra lo último que el SdG escribió.
 * `null` = nada que contar.
 *
 * MIRA TRES COSAS —si está cancelado, si Google todavía lo tiene, y el inicio y
 * el fin— Y NINGUNA MÁS. Eso es una decisión, no un olvido: no la «mejores»
 * agregando el título, los invitados ni su respuesta (RSVP).
 *
 * Un evento de OT lleva cinco invitados. Si un «acepto» o un «no voy» contara
 * como divergencia, cada OT sonaría hasta cinco veces en el teléfono de cinco
 * personas. Está medido en este sistema que eso termina con la gente apagando
 * las notificaciones: de 13 personas, las dos únicas que las probaron en serio
 * tenían los 13 avisos descartados. Una divergencia es que la OT dejó de estar
 * donde el SdG la puso, y para eso alcanzan el inicio y el fin.
 *
 * EL ECO DE LAS PROPIAS ESCRITURAS. Google también notifica los cambios que
 * escribió el SdG, y el más frecuente de todos va a ser la sincronización
 * moviendo una OT. Lo que lo distingue es `escrito`: guarda lo último que el
 * SdG mandó, así que esa notificación llega comparando igual contra igual y da
 * `null`. Quien escribe en Google tiene que actualizar `escrito` en cada
 * escritura propia; si no, cada una sonaría como un movimiento ajeno.
 *
 * Conviene que `escrito` se guarde con lo que Google devolvió, con zona: es lo
 * que tiene que hacer la escritura. Si no lo hace, igual no se rompe —una
 * cadena sin zona se lee como hora de Argentina, ver `mismoMomento`—.
 *
 * Un evento que el SdG todavía no escribió (`escrito` null) no diverge de
 * nada: no hay contra qué comparar.
 */
export function queDivergio(
  escrito: { inicio: string; fin: string } | null,
  enGoogle: {
    inicio: string;
    fin: string;
    cancelado: boolean;
    titulo?: string;
    invitados: { email: string; respuesta?: string }[];
  } | null,
): Divergencia | null {
  if (!escrito) return null;
  if (!enGoogle || enGoogle.cancelado) return "borrado";
  if (!mismoMomento(escrito.inicio, enGoogle.inicio) || !mismoMomento(escrito.fin, enGoogle.fin)) {
    return "movido";
  }
  return null;
}
