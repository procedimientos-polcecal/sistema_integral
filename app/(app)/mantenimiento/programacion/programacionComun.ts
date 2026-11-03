import { comoSeLee, diaDeLaSemana } from "@/lib/core/fechas";
import type { Grupo, Oficio, Turno } from "@/lib/mantenimiento/programacion";

/**
 * Lo que comparten los componentes de la pantalla de programación: la forma de
 * lo que devuelven las rutas, los textos y la llamada a la API.
 *
 * Está aparte para que la hoja de una persona, el padrón y la referencia sean
 * archivos propios sin importarse entre sí.
 */

// ── Lo que devuelven las rutas ───────────────────────────────

export interface Asignacion { empleadoId: string; dia: string; turno: Turno; pisada: boolean }

/**
 * Quién falta, **sin el motivo**. No tiene campo `tipo` a propósito: la ruta no
 * lo manda porque es dato médico y disciplinario que el diseño deja afuera de
 * Mantenimiento, y un tipo sin ese campo vuelve inalcanzable filtrarlo por
 * descuido desde una pantalla.
 */
export interface Ausente { empleadoId: string; dia: string; turno: Turno; oficio: Oficio }
export interface Persona { empleadoId: string; nombre: string; oficio: Oficio; grupo: Grupo | null }
export interface SinTurno { empleadoId: string; dia: string }

export interface Semana {
  dias: string[];
  asignaciones: Asignacion[];
  ausentes: Ausente[];
  candidatos: Record<string, string[]>;
  sinTurno: SinTurno[];
  personas: Persona[];
  sinReferencia?: true;
}

/** Una ausencia de las que cargó el que mira. Lleva el id: es lo que permite corregirla o borrarla. */
export interface AusenciaPropia {
  id: string;
  empleado_id: string;
  fecha_desde: string;
  fecha_hasta: string;
  tipo: string;
  observaciones: string | null;
}

// ── Textos ───────────────────────────────────────────────────

export const TURNOS: Turno[] = ["4-12", "8-16", "12-20"];
export const TURNO_TEXTO: Record<Turno, string> = { "4-12": "4 a 12", "8-16": "8 a 16", "12-20": "12 a 20" };

export const OFICIO_TEXTO: Record<Oficio, string> = {
  mecanico: "Mecánico",
  electricista: "Electricista",
  lubricador: "Lubricador",
};
export const ORDEN_OFICIO: Record<Oficio, number> = { mecanico: 0, lubricador: 1, electricista: 2 };

/**
 * Los cuatro tipos que el encargado puede anotar. Los demás los carga RRHH.
 *
 * Son **botones** en la hoja de la persona y no un desplegable, y no es un
 * detalle de estilo: las ausencias se cargan con una mediana de 39 días de
 * atraso, así que la pantalla sólo sirve si anotar una cuesta dos toques —la
 * persona y el tipo—. Un `<Select>` lo vuelve tres.
 */
export const TIPOS = [
  { valor: "ENFERMEDAD_ACCIDENTE_INCULPABLE", etiqueta: "Enfermedad o accidente" },
  { valor: "PERMISO_PERSONAL", etiqueta: "Permiso personal" },
  { valor: "INJUSTIFICADA", etiqueta: "Injustificada" },
  { valor: "OTRA", etiqueta: "Otra" },
] as const;

export function tipoTexto(valor: string): string {
  return TIPOS.find((t) => t.valor === valor)?.etiqueta ?? valor;
}

export const DIA_CORTO = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DIA_LARGO = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** "26/10": el día y el mes, sin el año. */
export function diaMes(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** "lunes 26/10" */
export function diaLargo(iso: string): string {
  return `${DIA_LARGO[diaDeLaSemana(iso)]} ${diaMes(iso)}`;
}

/** "el 26/10/2026" o "del 26/10/2026 al 28/10/2026". */
export function rangoComoSeLee(desde: string, hasta: string): string {
  return desde === hasta ? `el ${comoSeLee(desde)}` : `del ${comoSeLee(desde)} al ${comoSeLee(hasta)}`;
}

// ── Llamadas ─────────────────────────────────────────────────

/**
 * Una llamada a la API. Devuelve el error **como lo dijo la ruta**: los mensajes
 * de las rutas de acá están escritos para quien los lee ("Esa persona no es del
 * taller en esas fechas…") y traducirlos los volvería peores.
 */
export async function llamar(
  url: string,
  metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  cuerpo?: unknown
): Promise<{ ok: true; data: any } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: metodo,
      headers: cuerpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: data?.error ?? `Falló (error ${res.status})` };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "No se pudo conectar. Revisá la señal y volvé a probar." };
  }
}
