import * as XLSX from "xlsx";
import { localDateTime, toUtcDateOnly } from "./dates";

export function parseWorkbook(buffer: Buffer) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { rows, headers };
}

export interface ParsedSheet {
  rows: Record<string, unknown>[];
  headers: string[];
}

/** Parsea TODAS las hojas de un archivo (los reportes reales suelen venir con varias, ej. una de parámetros y otra con los datos). */
export function parseWorkbookAllSheets(buffer: Buffer): { sheetNames: string[]; sheets: Record<string, ParsedSheet> } {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheets: Record<string, ParsedSheet> = {};
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    sheets[name] = { rows, headers };
  }
  return { sheetNames: wb.SheetNames, sheets };
}

/** Elige la hoja cuyos encabezados mejor matchean las palabras clave esperadas (ej. "legajo", "nombre"). */
export function pickBestSheet(sheetNames: string[], sheets: Record<string, ParsedSheet>, keywords: string[]): string {
  let best = sheetNames[0];
  let bestScore = -1;
  for (const name of sheetNames) {
    const headers = sheets[name].headers.map((h) => h.toLowerCase());
    const score = keywords.reduce((acc, kw) => acc + (headers.some((h) => h.includes(kw)) ? 1 : 0), 0);
    if (score > bestScore && sheets[name].rows.length > 0) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}

export function excelSerialToDate(serial: number): Date {
  // Excel epoch: 1899-12-30
  const utcDays = Math.floor(serial - 25569);
  const utcMs = utcDays * 86400 * 1000;
  const fractionalDay = serial - Math.floor(serial);
  const ms = utcMs + Math.round(fractionalDay * 86400 * 1000);
  return new Date(ms);
}

/**
 * Interpreta strings de fecha en formato ISO ("2026-07-05...") o DD/MM/YYYY
 * (convención Argentina), tolerando un prefijo de día de semana como
 * "Lu 01/06/2026" (formato típico de reportes de relojes biométricos).
 */
export function parseDateString(value: string): Date | null {
  const trimmed = value.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return toUtcDateOnly(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const dmy = trimmed.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (dmy) {
    return toUtcDateOnly(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
  }
  return null;
}

// Nota: SheetJS (xlsx) con cellDates:true arma los Date de celdas de fecha/hora
// usando componentes UTC (no conoce zonas horarias). Por eso acá siempre se
// leen con getters UTC, y las fechas-calendario se normalizan a medianoche
// UTC para ser consistentes con el resto del módulo (ver `dates.ts`).
export function toDateOnlyFromCell(value: unknown): Date | null {
  if (value instanceof Date) return toUtcDateOnly(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  if (typeof value === "number") {
    const d = excelSerialToDate(value);
    return toUtcDateOnly(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }
  if (typeof value === "string" && value.trim()) {
    return parseDateString(value);
  }
  return null;
}

/** Interpreta números con formato argentino ("3.500,50" o "3500,50") o plano ("3500.5" / "3500"). */
export function parseNumeroAR(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.includes(",")) {
    const normalized = trimmed.replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    return isNaN(n) ? null : n;
  }
  const n = Number(trimmed);
  return isNaN(n) ? null : n;
}

export interface Marcacion {
  entradaStr: string;
  salidaStr: string | null;
}

export interface TokenMarcacion {
  tipo: "E" | "S";
  hora: string;
}

/** Extrae la secuencia cruda de marcas E/S de una celda "Marcaciones", ej. "E 08:07 - S 15:56". */
export function tokenizeMarcaciones(value: string): TokenMarcacion[] {
  return Array.from(value.matchAll(/([ES])\s*(\d{1,2}:\d{2})/g)).map((m) => ({
    tipo: m[1] as "E" | "S",
    hora: m[2],
  }));
}

const UMBRAL_MARCACION_FANTASMA_MINUTOS = 5;

/**
 * Descarta marcaciones "fantasma": el reloj biométrico a veces registra la
 * misma marca dos veces (el sensor lee la cara/huella de nuevo por error). Se
 * asume fantasma cuando cae a 5 minutos o menos de la marca anterior, y se
 * conserva solo la primera de cada grupo así detectado.
 */
export function filtrarMarcacionesFantasma(tokens: TokenMarcacion[]): TokenMarcacion[] {
  const result: TokenMarcacion[] = [];
  for (const t of tokens) {
    const anterior = result[result.length - 1];
    if (anterior) {
      const [h1, m1] = anterior.hora.split(":").map(Number);
      const [h2, m2] = t.hora.split(":").map(Number);
      const diffMin = Math.abs(h2 * 60 + m2 - (h1 * 60 + m1));
      if (diffMin <= UMBRAL_MARCACION_FANTASMA_MINUTOS) continue;
    }
    result.push(t);
  }
  return result;
}

/**
 * Empareja una secuencia de tokens en tramos entrada/salida por POSICIÓN
 * (0=entrada,1=salida,2=entrada,...), ignorando la letra E/S que trae cada
 * token. Esto es intencional: cuando un turno cruza la medianoche (ej. 20 a
 * 4), el reloj etiqueta la marcación de salida del día siguiente como si
 * fuera una "entrada" (es la primera marca de ese día calendario), así que la
 * letra no es confiable en el borde entre días. Dentro de un mismo día la
 * alternancia cronológica entrada/salida/entrada/salida sí se cumple siempre
 * en los reportes reales, así que emparejar por posición es más robusto.
 * Un token final sin pareja queda con salidaStr = null (fichada abierta).
 */
export function pairTokens(tokens: TokenMarcacion[]): Marcacion[] {
  const result: Marcacion[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    result.push({ entradaStr: tokens[i].hora, salidaStr: tokens[i + 1]?.hora ?? null });
  }
  return result;
}

/** Construye el instante real (hora de pared local) para un "HH:MM" en el día calendario `fecha`. */
export function horaStringToDate(fecha: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return localDateTime(fecha, h, m);
}

export interface DiaMarcacionesCrudo {
  fecha: Date; // día calendario (UTC-medianoche), ordenados ascendente por el llamador
  raw: string; // celda "Marcaciones" cruda de ese día, puede venir vacía
}

export interface TurnoResuelto {
  fecha: Date; // día al que se imputa la entrada (y las horas trabajadas)
  entradaStr: string;
  salidaStr: string | null;
  fechaSalida: Date; // día calendario de la salida: igual a `fecha`, o el siguiente si cruzó medianoche
}

export interface AvisoReconciliacion {
  fecha: Date;
  mensaje: string;
}

const MIN_HORAS_TURNO_CRUCE = 2;
const MAX_HORAS_TURNO_CRUCE = 14;
const UMBRAL_REINGRESO_RAPIDO_MINUTOS = 30;

/**
 * Reconstruye los turnos de un empleado a partir de sus celdas de
 * marcaciones día por día (ya ordenadas cronológicamente). Resuelve turnos
 * que cruzan la medianoche (ej. 20 a 4): si un día queda con una entrada sin
 * salida, se prueba cerrarla con la primera marca del día que sigue en los
 * datos. Si la duración resultante cae en un rango razonable de turno (2 a
 * 14 horas) se toma como la salida real cruzando medianoche; si no (por
 * ejemplo porque hay varios días sin datos en el medio, o la marcación de
 * salida simplemente nunca se registró), se deja como marcación faltante
 * para revisión manual.
 *
 * `abiertoPrevio` permite encadenar una fichada que quedó abierta en una
 * importación anterior (turno nocturno cuyo cierre cayó en el archivo
 * siguiente, subido después): se trata como si fuera el turno pendiente del
 * "día anterior" a este lote, para que el primer dato nuevo pueda cerrarlo.
 */
export function reconciliarMarcaciones(
  dias: DiaMarcacionesCrudo[],
  abiertoPrevio?: { fecha: Date; entradaStr: string } | null
): {
  turnos: TurnoResuelto[];
  avisos: AvisoReconciliacion[];
} {
  const turnos: TurnoResuelto[] = [];
  const avisos: AvisoReconciliacion[] = [];
  let pendiente: { fecha: Date; entradaStr: string } | null = abiertoPrevio ?? null;

  function cerrarPendienteComoAbierto(mensaje: string) {
    if (!pendiente) return;
    turnos.push({ fecha: pendiente.fecha, entradaStr: pendiente.entradaStr, salidaStr: null, fechaSalida: pendiente.fecha });
    avisos.push({ fecha: pendiente.fecha, mensaje });
    pendiente = null;
  }

  for (const dia of dias) {
    let tokens = filtrarMarcacionesFantasma(tokenizeMarcaciones(dia.raw));

    if (pendiente) {
      if (tokens.length === 0) {
        cerrarPendienteComoAbierto("Turno sin marcación de salida (el día siguiente con datos no tiene marcaciones)");
      } else {
        const horaAbierta = horaStringToDate(pendiente.fecha, pendiente.entradaStr);
        const horaCandidata = horaStringToDate(dia.fecha, tokens[0].hora);
        const horas = (horaCandidata.getTime() - horaAbierta.getTime()) / 3_600_000;
        if (horas >= MIN_HORAS_TURNO_CRUCE && horas <= MAX_HORAS_TURNO_CRUCE) {
          turnos.push({ fecha: pendiente.fecha, entradaStr: pendiente.entradaStr, salidaStr: tokens[0].hora, fechaSalida: dia.fecha });
          tokens = tokens.slice(1);
        } else {
          cerrarPendienteComoAbierto("Turno sin marcación de salida (no se encontró un cierre plausible en los días siguientes)");
        }
        pendiente = null;
      }
    }

    if (tokens.length === 1) {
      // Una sola marca suelta: puede ser un turno que sigue abierto (todavía
      // no se fue) o el arranque de un turno nocturno a cerrar con el día
      // siguiente. Se deja pendiente, como siempre.
      pendiente = { fecha: dia.fecha, entradaStr: tokens[0].hora };
    } else if (tokens.length > 1 && tokens.length % 2 === 1) {
      // Cantidad impar (más de una marca): la última quedó colgada sin su
      // salida. Si volvió a marcar poco después de su última salida (≤30
      // min: reingreso rápido, típico de un glitch del lector o un trámite
      // breve), se extiende ese último tramo hasta esta marca en vez de
      // dejarla suelta. Si el hueco es grande (horas), es un turno realmente
      // distinto que todavía no cerró: se deja pendiente, como siempre, sin
      // tocar los tramos completos ya formados.
      const dangling = tokens[tokens.length - 1];
      const ultimaSalidaCompleta = tokens[tokens.length - 2];
      const pares = pairTokens(tokens.slice(0, -1));
      const [h1, m1] = ultimaSalidaCompleta.hora.split(":").map(Number);
      const [h2, m2] = dangling.hora.split(":").map(Number);
      const gapMinutos = Math.abs(h2 * 60 + m2 - (h1 * 60 + m1));
      if (gapMinutos <= UMBRAL_REINGRESO_RAPIDO_MINUTOS) {
        pares[pares.length - 1] = { ...pares[pares.length - 1], salidaStr: dangling.hora };
      } else {
        pendiente = { fecha: dia.fecha, entradaStr: dangling.hora };
      }
      for (const par of pares) {
        if (par.salidaStr) {
          turnos.push({ fecha: dia.fecha, entradaStr: par.entradaStr, salidaStr: par.salidaStr, fechaSalida: dia.fecha });
        }
      }
    } else {
      const pares = pairTokens(tokens);
      for (const par of pares) {
        if (par.salidaStr) {
          turnos.push({ fecha: dia.fecha, entradaStr: par.entradaStr, salidaStr: par.salidaStr, fechaSalida: dia.fecha });
        }
      }
    }
  }
  cerrarPendienteComoAbierto("Turno sin marcación de salida (fin de los datos importados)");

  return { turnos, avisos };
}

/**
 * Extrae pares entrada/salida de una celda "Marcaciones" combinada, ej.
 * "E 08:07 - S 15:56" o con varios tramos por corte de almuerzo
 * "E 08:00 - S 12:00  E 13:00 - S 17:00".
 */
export function parseMarcaciones(value: string): Marcacion[] {
  return pairTokens(tokenizeMarcaciones(value));
}
