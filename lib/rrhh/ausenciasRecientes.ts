import type { SupabaseClient } from "@supabase/supabase-js";
import type { Notificacion } from "@/lib/home/notificaciones";

/**
 * Cuántas ausencias se cargaron desde la corrida anterior.
 *
 * ── POR QUÉ ESTO NO ES UN AVISO DE `lib/home/avisos.ts` ──────────────────────
 *
 * Los avisos de allá cuentan **stock**: cosas que están esperando a alguien y
 * siguen ahí hasta que se resuelven. Una ausencia cargada no espera nada —se
 * carga y listo—, así que no hay stock que contar y no tiene sentido en la
 * campana: diría un número que sólo crece.
 *
 * Lo que se pidió es otra cosa: que **enterarse** sea inmediato. O sea un
 * evento, no un estado. Por eso vive acá y no allá, y por eso su id no está en
 * `MODULO_POR_AVISO` — si alguien lo busca ahí, no lo va a encontrar, y esta
 * nota es para que no lo busque.
 *
 * ── A QUIÉN LE LLEGA ─────────────────────────────────────────────────────────
 *
 * A todos, y es deliberado: se pidió que una ausencia se notifique a todos los
 * usuarios enseguida. Como el id no declara módulo, `soloDeSusModulos` lo deja
 * pasar y nadie lo filtra. Eso coincide con lo que se quiere, pero **coincide
 * por dos razones distintas** —no tener módulo y tener que llegarle a todos—,
 * así que conviene dejarlo escrito: el día que alguien quiera restringirlo, el
 * lugar es `sinLoQueNoPuedeAtender`, no esta función.
 *
 * Y es una audiencia distinta de la del correo de RR.HH. de las 15:50, que va
 * a doce encargados con el detalle del día. Son dos públicos: ese correo es
 * para quien administra, esto es para que el resto se entere en el momento.
 */

/** El id es sólo de acá: no existe en `lib/home/avisos.ts`. Ver arriba. */
const ID = "rrhh-ausencias-cargadas";

/**
 * Cuántas ausencias entraron al sistema en la ventana `[desde, hasta)`.
 *
 * **La ventana es semiabierta y eso no es cosmética.** `hasta` es el instante
 * que la corrida va a guardar como `visto_en`, y se captura **antes** de
 * contar. Sin el corte de arriba, una ausencia cargada entre que se captura la
 * hora y que corre el `count` entra en esta corrida y otra vez en la siguiente
 * —`created_at >= visto_en` la vuelve a agarrar—, y el mismo hecho se avisa
 * dos veces. Es el único canal de este cron que compara por tiempo en vez de
 * por conteo, así que es el único expuesto a esto.
 *
 * **Por `created_at` y nunca por `fecha_desde`**, y la diferencia no es
 * cosmética: la mediana entre que una ausencia empieza y que alguien la carga
 * es de **33 días** —medido sobre las 163 que había el 16/11/2026—, y la fila
 * más reciente de producción ese día tenía `fecha_desde` del 02/11 contra un
 * `created_at` del 16/11. Filtrando por la fecha de la ausencia, una corrida
 * de quince minutos no vería casi nunca nada, y cuando viera algo sería una
 * ausencia que empieza hoy, no una que se acaba de cargar.
 *
 * Un `count … head`: no hace falta traer las filas, sólo cuántas son. El
 * mensaje dice el número y la pantalla dice el resto.
 *
 * Un error **no es un cero**. El cron no manda nada en los dos casos, pero uno
 * se registra: un cero silencioso todos los días es indistinguible de que no
 * se cargue ninguna ausencia.
 */
export async function contarAusenciasDesde(
  admin: SupabaseClient,
  desde: string,
  hasta: string
): Promise<{ cuantas: number; error?: string }> {
  const { count, error } = await admin
    .from("ausencias")
    .select("id", { count: "exact", head: true })
    .gte("created_at", desde)
    .lt("created_at", hasta);

  if (error) return { cuantas: 0, error: error.message };
  return { cuantas: count ?? 0 };
}

/**
 * La línea del push, o `null` si no hay ninguna.
 *
 * `null` y no una línea que diga cero: no se manda una notificación para
 * avisar que no pasó nada — ésa es la que enseña a ignorarlas.
 *
 * **El número no va en el título**, aunque sea lo primero que uno escribe.
 * `resumirElMovimiento` imprime la `cantidad` como incremento, así que con el
 * título «Se cargaron 3 ausencias» el push decía «3 más · Se cargaron 3
 * ausencias»: el mismo 3 como total y como incremento en la misma línea. El
 * docstring de esa función lo prohíbe con todas las letras —«un “3” que ayer
 * era el total y hoy es el incremento es peor que cualquiera de los dos»— y
 * ésta es la única `Notificacion` del sistema que nace siendo un delta en vez
 * de un stock, así que era la única que podía caer en eso.
 *
 * **El `href` va a `/disponibilidad` y no a `/rrhh/ausencias`**, porque esto le
 * llega a todos: RRHH lo tienen 8 de 16 personas, y una notificación que lleva
 * a una pantalla cerrada es peor que no llevar a ninguna. Disponibilidad es
 * transversal —la ve cualquiera con sesión— y es donde se ve quién no viene.
 *
 * El mensaje dice cuántas y no quiénes a propósito: el motivo de una ausencia
 * no sale nunca del lado abierto, y un push lo leería cualquiera que mire el
 * teléfono de otro.
 */
export function lineaDeAusencias(cuantas: number): Notificacion | null {
  if (cuantas <= 0) return null;

  return {
    id: ID,
    titulo: "Ausencias cargadas",
    cantidad: cuantas,
    href: "/disponibilidad",
  };
}
