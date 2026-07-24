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
