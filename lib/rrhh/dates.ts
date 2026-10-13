import { hoyEnArgentina } from "@/lib/core/fechas";
/**
 * Convención de fechas en todo el módulo RRHH:
 * - Un campo "fecha" (calendario, sin hora) siempre se representa como
 *   medianoche UTC (igual que produce `new Date("YYYY-MM-DD")` tanto en el
 *   navegador como en Node). Por eso SIEMPRE se lee con getters UTC
 *   (getUTCDay, getUTCFullYear, etc.).
 * - Un campo "horaEntrada"/"horaSalida" es un instante real (con hora de
 *   reloj) que representa la hora de pared en Argentina. Argentina no tiene
 *   horario de verano desde 2009: UTC-3 fijo todo el año, así que ese
 *   desplazamiento se aplica siempre a mano (`localDateTime`/`formatHHMM`),
 *   sin depender del huso horario configurado en el runtime. Ver el spec de
 *   la Fase 2 (riesgo #12): no mezclar este manejo manual con delegar el
 *   offset a Postgres para el mismo campo.
 */

const OFFSET_ARGENTINA_HORAS = 3; // hora UTC = hora de Argentina + 3 (sin horario de verano)

export function toUtcDateOnly(y: number, m0: number, d: number): Date {
  return new Date(Date.UTC(y, m0, d));
}

export function utcDateOnlyFrom(date: Date): Date {
  return toUtcDateOnly(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function dayOfWeekUtc(date: Date): number {
  return date.getUTCDay();
}

/** Construye un instante real (hora de pared en Argentina) para el día calendario `fecha` (UTC-midnight). */
export function localDateTime(fecha: Date, hours: number, minutes: number, seconds = 0): Date {
  return new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), hours + OFFSET_ARGENTINA_HORAS, minutes, seconds, 0)
  );
}

/** Formatea un instante real como "HH:MM" en hora de Argentina. */
export function formatHHMM(instante: Date): string {
  return instante.toLocaleTimeString("en-GB", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Minutos desde medianoche, en hora de Argentina, de un instante real (0-1439). */
export function minutosDelDiaArgentina(instante: Date): number {
  const utcMin = instante.getUTCHours() * 60 + instante.getUTCMinutes();
  return (((utcMin - OFFSET_ARGENTINA_HORAS * 60) % 1440) + 1440) % 1440;
}

/**
 * El día calendario (medianoche UTC) en que cae un instante real, mirado en
 * hora de Argentina. Es lo que dice en qué día terminó un turno: una salida a
 * las 04:00 locales es 07:00 UTC del mismo día, pero una a las 22:00 locales es
 * 01:00 UTC del día siguiente, y `toISOString().slice(0, 10)` daría el día
 * equivocado.
 */
export function fechaArgentinaDe(instante: Date): Date {
  return utcDateOnlyFrom(new Date(instante.getTime() - OFFSET_ARGENTINA_HORAS * 3_600_000));
}

/**
 * Un día calendario (medianoche UTC) como "YYYY-MM-DD", que es como lo guardan
 * y lo comparan las columnas `date`.
 *
 * Sólo vale para días calendario. Un instante real (una hora de entrada o de
 * salida) no se pasa por acá: cerca de la medianoche el día UTC no es el día de
 * Argentina, y para eso está `fechaArgentinaDe`.
 */
export function diaIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Hoy en Argentina, como día calendario (medianoche UTC), que es la forma que
 * usa todo este módulo.
 *
 * Existe porque `utcDateOnlyFrom(new Date())` **no es hoy**: lee la fecha del
 * instante en UTC, y Vercel corre en UTC. Después de las 21:00 de acá ya
 * devuelve el día siguiente. Medido el 13/10/2026: el recálculo nocturno corre
 * a las 00:28 UTC —21:28 de Argentina— y con esa cuenta recalculaba el día de
 * mañana, creando 68 filas de `calculos_diarios` que marcaban ausente a toda
 * la planta para un día que todavía no había empezado.
 *
 * La cuenta de qué día es en Argentina vive en `lib/core/fechas.ts` y es la
 * misma que usan Calidad y Compras; acá sólo se la pasa a la forma `Date`.
 */
export function hoyComoDiaArgentina(): Date {
  const [y, m, d] = hoyEnArgentina().split("-").map(Number);
  return toUtcDateOnly(y, m - 1, d);
}
