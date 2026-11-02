import type { Turno } from "@/lib/mantenimiento/programacion";

/**
 * Lo que decide cómo es un evento de la agenda, sin red y sin base.
 *
 * `Turno` NO se define acá: ya existe en `lib/mantenimiento/programacion.ts`
 * con los mismos tres valores y el mismo significado —los turnos del taller—.
 * Definir un segundo es cómo dos cosas iguales se separan sin que nada avise.
 */

/** Cuánto dura el evento de una OT en el calendario. */
export const DURACION_OT_MINUTOS = 90;

/**
 * A quién se invita cuando una OT entra al calendario, en el orden de la spec.
 * Son cinco, y ese número importa: ver `queDivergio` en `divergencia.ts`.
 */
export const INVITADOS_DE_UNA_OT: readonly string[] = [
  "nicolaslenzetti@polcecal.com",
  "gerencia@polcecal.com",
  "produccion@polcecal.com",
  "mantenimiento@polcecal.com",
  "soporte.mantenimiento@polcecal.com",
];

/** Hora de arranque de cada turno, en hora de pared (hh:mm). */
const ARRANQUE_DEL_TURNO: Record<Turno, string> = {
  "4-12": "04:00",
  "8-16": "08:00",
  "12-20": "12:00",
};

/**
 * El horario de una OT en el calendario: arranca con el turno y dura 1:30.
 *
 * Las cadenas se arman con las horas de la tabla de arriba y **sin `Date`**:
 * el servidor corre en UTC, y una `Date` metería su zona en una hora que es de
 * pared de Argentina. En local, donde la zona coincide con la de quien
 * desarrolla, ese bug no se ve. Ninguno de los tres turnos más 90 minutos
 * cruza la medianoche, así que el fin siempre cae en la misma fecha.
 *
 * Sale sin zona (`2026-11-03T08:00:00`): quien lo escriba en Google manda la
 * zona aparte, en el campo `timeZone`.
 */
export function horarioDeLaOT(fecha: string, turno: Turno): { inicio: string; fin: string } {
  const [h, m] = ARRANQUE_DEL_TURNO[turno].split(":").map(Number);
  const finEnMinutos = h * 60 + m + DURACION_OT_MINUTOS;
  const dos = (n: number) => String(n).padStart(2, "0");
  const fin = `${dos(Math.floor(finEnMinutos / 60))}:${dos(finEnMinutos % 60)}`;
  return {
    inicio: `${fecha}T${ARRANQUE_DEL_TURNO[turno]}:00`,
    fin: `${fecha}T${fin}:00`,
  };
}

const FECHA_HORA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * El instante de una fecha-hora ISO, en milisegundos, o `null` si no es una
 * fecha-hora válida. `conZona` dice si traía `Z` o un desfase.
 *
 * Se calcula con `Date.UTC` sobre las partes y no con `Date.parse`: una cadena
 * sin zona la interpretaría en la zona del servidor. Una sin zona se toma como
 * UTC **sólo para poder compararla con otra sin zona**; contra una con zona no
 * significa nada, y quien compara tiene que mirar `conZona`.
 */
export function instanteDe(texto: string): { ms: number; conZona: boolean } | null {
  const r = FECHA_HORA.exec(texto);
  if (!r) return null;
  const [anio, mes, dia, hora, min, seg] = r.slice(1, 7).map(Number);
  if (mes < 1 || mes > 12 || dia < 1 || hora > 23 || min > 59 || seg > 59) return null;
  const ms = Date.UTC(anio, mes - 1, dia, hora, min, seg);
  // Date.UTC desborda en silencio (31 de febrero → 3 de marzo): se descarta.
  if (new Date(ms).getUTCDate() !== dia) return null;
  const zona = r[7];
  if (!zona) return { ms, conZona: false };
  if (zona === "Z") return { ms, conZona: true };
  const signo = zona[0] === "-" ? -1 : 1;
  const desfase = Number(zona.slice(1, 3)) * 60 + Number(zona.slice(4, 6));
  return { ms: ms - signo * desfase * 60_000, conZona: true };
}

const CORREO = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Qué está mal en lo que entró, todo junto y en castellano. Vacío = está bien.
 *
 * Devuelve **todos** los problemas y no el primero, como `validar()` de
 * `lib/core/validar.ts`: informar de a uno obliga a corregir un formulario en
 * cuatro intentos, y es la vara que este repo ya decidió.
 */
export function problemasDelEvento(e: {
  titulo: string;
  inicio: string;
  fin: string;
  invitados: string[];
}): string[] {
  const problemas: string[] = [];

  if (!e.titulo || e.titulo.trim() === "") problemas.push("Falta el título del evento");

  const inicio = instanteDe(e.inicio);
  const fin = instanteDe(e.fin);
  if (!inicio) problemas.push(`El inicio «${e.inicio}» no es una fecha y hora válida`);
  if (!fin) problemas.push(`El fin «${e.fin}» no es una fecha y hora válida`);
  if (inicio && fin) {
    if (inicio.conZona !== fin.conZona) {
      // Sin zona no hay instante: compararlos daría un orden inventado.
      problemas.push("El inicio y el fin tienen que venir los dos con zona horaria o los dos sin ella");
    } else if (fin.ms <= inicio.ms) {
      problemas.push("El evento tiene que terminar después de que empieza");
    }
  }

  for (const correo of e.invitados) {
    if (!CORREO.test(correo)) problemas.push(`El invitado «${correo}» no es un correo válido`);
  }

  return problemas;
}
