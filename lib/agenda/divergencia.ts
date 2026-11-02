import { instanteDe } from "./evento";

export type Divergencia = "borrado" | "movido";

/** ¿Es el mismo momento? Por instante si los dos traen zona; si no, por texto. */
function mismoMomento(a: string, b: string): boolean {
  if (a === b) return true;
  const x = instanteDe(a);
  const y = instanteDe(b);
  // Sólo con zona en los dos hay instante que comparar: `...-03:00` y `...Z`
  // pueden ser la misma hora y no tienen por qué coincidir como texto.
  return !!x && !!y && x.conZona && y.conZona && x.ms === y.ms;
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
 * Para que «igual» sea cierto, `escrito` tiene que guardarse con la misma forma
 * con que Google la devuelve (con zona). Una cadena sin zona contra una con
 * zona no se puede decidir y se cuenta como movida.
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
