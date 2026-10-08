import { addUtcDays, diaIso, fechaArgentinaDe } from "../dates";
import { DIAS_DEL_CRON } from "./rango";

/**
 * Lo que la pantalla de marcaciones decide sobre Lenox y que no es dibujo.
 * Vive acá y no en el componente para poder probarlo: las pantallas no tienen
 * tests en este repo.
 */

/** Cuánto se espera tras un 429 si la respuesta no dice otra cosa: lo que dice el mensaje del cliente. */
export const ESPERA_TRAS_429_SEGUNDOS = 15 * 60;

/**
 * Los últimos 7 días contando hoy, como "AAAA-MM-DD".
 *
 * "Hoy" es el de Argentina y no el de UTC: de noche (después de las 21 hs) el
 * día UTC ya es mañana, y con `toISOString().slice(0, 10)` el rango por defecto
 * terminaría en una fecha que todavía no pasó.
 */
export function rangoPorDefecto(ahora: Date): { desde: string; hasta: string } {
  const hoy = fechaArgentinaDe(ahora);
  return { desde: diaIso(addUtcDays(hoy, -(DIAS_DEL_CRON - 1))), hasta: diaIso(hoy) };
}

/**
 * Cuántos segundos hay que esperar según el `Retry-After` de la ruta. Si falta
 * o no es un número positivo, la espera que dice el mensaje: no se asume que
 * "no hay que esperar".
 */
export function segundosDeEspera(retryAfter: string | null | undefined): number {
  const n = Number(retryAfter);
  return retryAfter && Number.isFinite(n) && n > 0 ? Math.ceil(n) : ESPERA_TRAS_429_SEGUNDOS;
}

/**
 * Hasta cuándo (en ms desde epoch) tiene que seguir bloqueado el botón según la
 * última corrida anotada, o `null` si no hay por qué.
 *
 * Sirve para que recargar la página no destrabe el botón: el bloqueo es de la
 * cuenta de Lenox y no de quien apretó, y la corrida del cron que recibe un 429
 * también lo prolonga. El 429 se reconoce por el `(429)` con que termina su
 * mensaje; si alguien reescribe ese texto, el fallo es no bloquear y no
 * bloquear de más —y el servidor sigue contestando 429 con el mensaje—.
 */
export function bloqueoPorUltimaSync(
  sync: { ok: boolean; error: string | null; created_at: string } | null,
  ahora: number
): number | null {
  if (!sync || sync.ok || !sync.error || !/\(429\)\s*$/.test(sync.error.trim())) return null;
  const hasta = new Date(sync.created_at).getTime() + ESPERA_TRAS_429_SEGUNDOS * 1000;
  return Number.isFinite(hasta) && hasta > ahora ? hasta : null;
}

/** "14 min 05 s", "45 s": lo que falta, para el botón. */
export function textoDeEspera(msRestantes: number): string {
  const total = Math.max(0, Math.ceil(msRestantes / 1000));
  const min = Math.floor(total / 60);
  const seg = total % 60;
  if (min === 0) return `${seg} s`;
  return `${min} min ${String(seg).padStart(2, "0")} s`;
}
