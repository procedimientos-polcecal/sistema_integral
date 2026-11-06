import { serialDelDia } from "@/lib/core/fechaDeSheets";

/**
 * Cómo se convierte un valor de la base en una celda del libro de respaldo.
 *
 * Está aparte de `instantaneas.ts` porque es lo único de todo el respaldo que
 * puede estar mal sin que nada avise: una consulta que falla se ve, una hora
 * corrida tres horas no. Son funciones puras para poder fijarlas con tests.
 */

/**
 * Un embed de PostgREST llega como objeto o como arreglo según lo que infiera
 * Supabase, y las dos formas conviven en el mismo proyecto. Esto resuelve las
 * dos, igual que hace `valorHoraDe()` en RRHH.
 */
export function uno<T>(embed: unknown): T | null {
  if (!embed) return null;
  return (Array.isArray(embed) ? (embed[0] ?? null) : embed) as T | null;
}

export type Persona = { legajo: string | null; apellido: string | null; nombre: string | null };

/** `APELLIDO, Nombre`, o el legajo solo si no hay nombre. Vacío si no vino el embed. */
export function quien(embed: unknown): string {
  const p = uno<Persona>(embed);
  if (!p) return "";
  const nombre = [p.apellido, p.nombre].filter(Boolean).join(", ");
  return nombre || (p.legajo ?? "");
}

export function nombreDe(embed: unknown): string {
  return uno<{ nombre: string | null }>(embed)?.nombre ?? "";
}

/**
 * Una fecha `YYYY-MM-DD` como serial de Sheets, o vacío si no es una fecha.
 *
 * Serial y no texto: la escritura va con `USER_ENTERED`, así que un
 * `"05/10/2026"` lo interpreta la planilla según su locale y puede quedar el
 * 10 de mayo. Es la misma trampa que dio vuelta 885 fechas en Compras, por el
 * otro lado. Un serial no se interpreta.
 *
 * Acepta un timestamp completo y se queda con el día.
 */
export function fecha(iso: string | null | undefined): string | number {
  return serialDelDia(String(iso ?? "").slice(0, 10)) ?? "";
}

/**
 * La hora de una marcación, en hora de Argentina y como `HH:MM`.
 *
 * **`hora_entrada` no es una hora: es un instante en UTC.** Llega como
 * `2026-08-19T07:05:00+00:00`, y eso en la pantalla se ve como las 04:05 —
 * `formatHora()` de `FichadasClient` lo convierte con
 * `timeZone: America/Argentina/Buenos_Aires`. Copiarlo crudo al respaldo
 * pondría una hora tres horas adelantada al lado del nombre de la persona, sin
 * ninguna marca de que está corrida.
 *
 * Esto ya pasó una vez en este módulo y en la dirección contraria: la
 * importación desde APPRRHH leyó 2.877 fichadas con el huso del proceso y las
 * movió tres horas. El respaldo tiene que decir lo mismo que la pantalla que
 * respalda, y por eso usa exactamente la misma conversión.
 *
 * Como texto y no como fracción de día: lo que hace falta es poder leerlo, y
 * un `08:30` escrito con `USER_ENTERED` la planilla lo reconoce como hora
 * igual.
 */
export function hora(instante: string | null | undefined): string {
  const s = String(instante ?? "").trim();
  if (!s) return "";
  const ms = Date.parse(s);
  if (isNaN(ms)) return "";
  return new Date(ms).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

/**
 * Un número, o vacío si no lo es. Nunca `NaN` ni `null` en una celda.
 *
 * **El descarte de null y de la cadena vacía va antes de `Number()`, y no es
 * cosmético**: `Number(null)` y `Number("")` son `0`, no `NaN`. Sin esta
 * guarda, una columna sin calcular —horas extra que el motor todavía no
 * resolvió, un ensayo al que le falta un dato— se respaldaba como un cero, que
 * es un valor y no un hueco. En una planilla de horas eso no se distingue de
 * "trabajó cero horas", y el respaldo deja de ser una copia para pasar a ser
 * una afirmación. Lo encontró el test, no la lectura.
 */
export function numero(v: unknown): string | number {
  if (v === null || v === undefined || v === "") return "";
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : "";
}

/**
 * Un booleano como `SI` o vacío, no como `TRUE`/`FALSE`.
 *
 * Vacío y no `NO` a propósito: en una columna de 4.000 filas donde casi todo
 * es `NO`, lo que hace falta ver de un vistazo es dónde dice que sí.
 */
export const si = (v: unknown): string => (v ? "SI" : "");

/** La fecha de hace `dias` días, en ISO, para acotar las ventanas. */
export function desdeHace(hoy: string, dias: number): string {
  const ms = Date.parse(`${hoy}T00:00:00Z`) - dias * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
