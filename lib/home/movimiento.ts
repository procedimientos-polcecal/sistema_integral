import { diaDeLaSemana } from "@/lib/core/fechas";
import type { Notificacion } from "./notificaciones";

/**
 * Lo que se movió desde el resumen anterior.
 *
 * ── POR QUÉ EXISTE ESTE ARCHIVO ──────────────────────────────────────────────
 *
 * El resumen diario contaba **stocks** —«23 órdenes de trabajo atrasadas», «15
 * equipos sin ningún service»— y un stock casi no se mueve de un día para el
 * otro. O sea que el push de mañana decía lo mismo que el de hoy, y una
 * notificación que repite el mensaje enseña a ignorarla.
 *
 * Medido contra producción el 18/10/2026, y los cuatro números dicen lo mismo:
 *
 *   - «Facturas en el buzón sin vincular: 1» — esa factura entró el 05/10.
 *     Trece días diciendo lo mismo.
 *   - «Equipos sin ningún service: 15» — hay **un solo service registrado en
 *     todo el sistema**, así que ese número no baja nunca.
 *   - «Órdenes de trabajo atrasadas: 23» — 19 tienen más de 7 días y la más
 *     vieja es del 11/12/2025.
 *   - «Requerimientos esperando aprobación» — en 14 días hubo 4 con cero
 *     entradas y cero salidas: cuatro pushes idénticos al anterior.
 *
 * Y la prueba de que ya costó: de 13 personas, las dos únicas que probaron las
 * notificaciones en serio tienen **los 13 avisos descartados** cada una.
 * Descartar era la única defensa contra un mensaje que se repite.
 *
 * ── LA REGLA ─────────────────────────────────────────────────────────────────
 *
 * **La campana muestra el stock, el push muestra el movimiento.** Son dos cosas
 * distintas y hasta ahora eran la misma: la campana es para entrar a mirar el
 * depósito cuando uno quiere, y el push es para enterarse sin entrar. Con eso
 * un aviso no se puede acumular: aparece el día que se mueve y se va solo al
 * día siguiente.
 *
 * El diseño completo está en
 * `docs/superpowers/specs/2026-10-18-a-quien-le-avisa-el-sdg-design.md`.
 */

/** Lo que decía la última foto: por `notificacion_id`, su cantidad. */
export type Foto = Map<string, number>;

/**
 * Los avisos que **subieron** desde la foto, con `cantidad` reemplazada por
 * cuánto subieron.
 *
 * Tres casos que no son obvios:
 *
 *   - **Lo que bajó no sale.** Que una cola se vacíe es una buena noticia y no
 *     pide nada; avisarlo duplicaría el volumen para no pedir nada.
 *   - **Lo que no está en la foto subió desde cero**, así que entra con su
 *     cantidad entera. Es un aviso que apareció después de la última foto.
 *   - **Lo que está en la foto y hoy no existe no genera nada.** Su conteo
 *     llegó a cero y `avisosDeConteos` ya no lo devuelve; la foto lo recuerda y
 *     eso no es motivo para decir nada.
 */
export function loQueSeMovio(avisos: Notificacion[], foto: Foto): Notificacion[] {
  return avisos.flatMap((a) => {
    const subio = a.cantidad - (foto.get(a.id) ?? 0);
    return subio > 0 ? [{ ...a, cantidad: subio }] : [];
  });
}

/**
 * Si hoy toca mandar los totales en vez del movimiento. Los lunes.
 *
 * **Es la red del diseño y sacarla lo deja sin red.** Contar sólo el
 * movimiento tiene un costo: algo que dejó de moverse no se nombra nunca más, y
 * hay una orden de trabajo atrasada desde el 11/12/2025 que quedaría muda para
 * siempre. Un día por semana el push lleva los totales, que es la contracara
 * exacta del problema — diario es movimiento, semanal es lo que hay—, y una vez
 * por semana un mensaje parecido al de la semana pasada no cansa a nadie.
 *
 * `diaDeLaSemana` devuelve 0 para domingo, así que el lunes es 1.
 */
export function esDiaDeRecordatorio(fecha: string): boolean {
  return diaDeLaSemana(fecha) === 1;
}

/** Qué resumen le toca al día de hoy. */
export type QueMandar = "nada" | "movimiento" | "totales";

/**
 * Qué mandar hoy, según qué día es y cuál fue la última foto.
 *
 * **Vive acá y no en la ruta porque es la decisión, y una decisión se prueba.**
 * Es la regla del repo: lo que importa se saca de la ruta a `lib/`.
 *
 * ── LA IDEMPOTENCIA DEL CRON VIVE EN LA PRIMERA LÍNEA ────────────────────────
 *
 * Para el movimiento alcanzaba con el `upsert` de la foto: la segunda corrida
 * del día compara contra lo que escribió la primera y da cero. **Pero el
 * resumen de los lunes no mira la foto** —son totales—, así que un reintento
 * mandaba el mismo push dos veces. Y el disparo a mano con el que se prueba
 * esto en producción es exactamente ese caso.
 *
 * Si la última foto es la de hoy, esta corrida ya pasó: no se manda nada.
 *
 * ── LOS TOTALES NO NECESITAN FOTO ────────────────────────────────────────────
 *
 * Por eso el lunes se decide **antes** que el primer día. Cortar por "no hay
 * foto" también el lunes perdería el recordatorio de toda esa semana, y el
 * primer día con la tabla viva puede perfectamente caer lunes.
 *
 * ── SIN FOTO NO HAY MOVIMIENTO ───────────────────────────────────────────────
 *
 * El primer día no hay con qué comparar. Tratarlo como "todo es nuevo" sería
 * un push de estreno con los trece avisos, que es justo lo que esto evita.
 */
export function queMandarHoy(cuando: {
  fechaDeLaFoto: string | null;
  hoy: string;
}): QueMandar {
  if (cuando.fechaDeLaFoto === cuando.hoy) return "nada";
  if (esDiaDeRecordatorio(cuando.hoy)) return "totales";
  if (cuando.fechaDeLaFoto === null) return "nada";
  return "movimiento";
}
