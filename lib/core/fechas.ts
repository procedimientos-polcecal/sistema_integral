/**
 * El día de calendario, visto desde Argentina.
 *
 * EL PROBLEMA
 *
 * `new Date().toISOString().slice(0, 10)` parece "hoy" y es "hoy en UTC".
 * Vercel corre en UTC, así que desde las **21:00 de Argentina** el servidor ya
 * cree que es mañana. Y en el navegador da igual de mal por el otro camino: el
 * reloj está en hora de Argentina, pero `toISOString()` convierte a UTC antes
 * de recortar.
 *
 * Había veinte lugares haciendo eso. El que más molesta es el remis: la pantalla
 * existe para mirar de noche a qué hora sale el de mañana, y a partir de las
 * nueve mostraba el día equivocado — justo en la franja en que se usa.
 *
 * LA CONVENCIÓN
 *
 * Argentina no tiene horario de verano desde 2009: UTC-3 fijo todo el año. El
 * desplazamiento se aplica a mano y no se delega al huso del runtime, igual que
 * en `lib/rrhh/dates.ts`, que ya lo explica para las horas de fichada. Así el
 * resultado no depende de en qué región quedó desplegada la función ni de la
 * computadora de quien mira.
 *
 * QUÉ **NO** ES ESTO
 *
 * No reemplaza a `lib/rrhh/dates.ts`. Ahí un "día calendario" se representa
 * como un `Date` a medianoche UTC y se lee con getters UTC, y el motor de
 * liquidación depende de esa forma de punta a punta. Esto trabaja con textos
 * "YYYY-MM-DD", que es la forma en que viajan las fechas por la API y en que
 * Postgres guarda una columna `date`. Los dos conviven: éste es para decidir
 * **qué día es hoy**, aquél para hacer cuentas con los días de una liquidación.
 */

/** Hora de Argentina = hora UTC − 3, sin horario de verano. */
const OFFSET_ARGENTINA_MS = 3 * 60 * 60 * 1000;

/**
 * La fecha de calendario en Argentina de un instante, como "YYYY-MM-DD".
 *
 * El parámetro existe para poder probarla: en producción se llama sin nada.
 */
export function fechaEnArgentina(instante: Date = new Date()): string {
  return new Date(instante.getTime() - OFFSET_ARGENTINA_MS).toISOString().slice(0, 10);
}

/** Hoy en Argentina, como "YYYY-MM-DD". */
export function hoyEnArgentina(instante?: Date): string {
  return fechaEnArgentina(instante);
}

/**
 * Un día relativo a hoy en Argentina: `1` es mañana, `-1` ayer.
 *
 * Se corre sobre la fecha ya resuelta y no sobre el instante, así el resultado
 * es siempre el día siguiente del calendario. Hacerlo con `d.setDate(d.getDate()
 * + 1)` sobre un instante y recortar en UTC arrastra el mismo error de arriba.
 */
export function diaEnArgentina(dias: number, instante?: Date): string {
  return sumarDias(fechaEnArgentina(instante), dias);
}

/**
 * Suma días a una fecha "YYYY-MM-DD" y devuelve otra igual.
 *
 * La cuenta se hace en UTC a propósito: una fecha sin hora no tiene huso, y
 * pasarla por la hora local es cómo se pierde un día al cruzar el mes.
 */
export function sumarDias(iso: string, dias: number): string {
  const t = comoUtc(iso);
  t.setUTCDate(t.getUTCDate() + dias);
  return t.toISOString().slice(0, 10);
}

/** El día de la semana de una fecha "YYYY-MM-DD". 0 = domingo, 6 = sábado. */
export function diaDeLaSemana(iso: string): number {
  return comoUtc(iso).getUTCDay();
}

/**
 * Los siete días de la semana que contiene a `iso`, de lunes a domingo.
 *
 * Lunes primero porque es como se mira una semana de trabajo. `corrimiento` mueve
 * semanas enteras: `-1` es la anterior, `1` la siguiente.
 */
export function semanaDe(iso: string, corrimiento = 0): string[] {
  const dow = diaDeLaSemana(iso);
  // Domingo es 0 pero cierra la semana, así que retrocede seis y no cero.
  const lunes = sumarDias(iso, -(dow === 0 ? 6 : dow - 1) + corrimiento * 7);
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}

/** Una fecha "YYYY-MM-DD" como la escribe una persona: 24/08/2026. */
export function comoSeLee(iso: string): string {
  const [a, m, d] = iso.split("-");
  return d && m && a ? `${d}/${m}/${a}` : iso;
}

function comoUtc(iso: string): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, (m ?? 1) - 1, d ?? 1));
}
