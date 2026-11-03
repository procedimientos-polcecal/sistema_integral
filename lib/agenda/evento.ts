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

/** ¿Es un correo que la ruta va a aceptar? La pantalla lo usa para no ofrecer lo que `problemasDelEvento` rechazaría. */
export function esCorreo(texto: string): boolean {
  return CORREO.test(texto);
}

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
    if (!esCorreo(correo)) problemas.push(`El invitado «${correo}» no es un correo válido`);
  }

  return problemas;
}

// ── Mandar una OT al calendario ──────────────────────────────────

/** Los tres turnos del taller, los mismos que `horarioDeLaOT` sabe arrancar. */
export const TURNOS_DEL_TALLER = Object.keys(ARRANQUE_DEL_TURNO) as Turno[];

/**
 * La fecha con la que una OT entra al calendario: `fecha_ejecucion_pendiente`
 * cuando la hay y, si no, `fecha_ejecucion`, o `null` si no tiene ninguna.
 *
 * La pendiente es la que **el SdG fijó y la planilla todavía no devolvió** —el
 * derrame tarda de 3 a 53 horas—, o sea la que la persona acaba de elegir. Si
 * se mirara sólo `fecha_ejecucion`, una OT recién postergada caería en el
 * calendario en el día que ya no es. Una pendiente en blanco no cuenta.
 */
export function fechaParaElCalendario(o: {
  fecha_ejecucion: string | null;
  fecha_ejecucion_pendiente?: string | null;
}): string | null {
  const pendiente = o.fecha_ejecucion_pendiente?.trim();
  if (pendiente) return pendiente;
  return o.fecha_ejecucion?.trim() || null;
}

/** Una fecha `AAAA-MM-DD` que existe en el calendario. */
function esFechaDelDia(texto: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) && instanteDe(`${texto}T00:00:00`) !== null;
}

/**
 * Qué impide mandar esta OT al calendario, todo junto y en castellano. Vacío =
 * se puede. Recibe **la fecha ya resuelta** (`fechaParaElCalendario`).
 *
 * Valida la fecha porque `horarioDeLaOT` no lo hace: arma el texto con lo que le
 * den, y una fecha mal formada daría un evento ilegible que en cada
 * notificación de Google saldría «movido» para siempre. La falta de fecha es el
 * caso real y frecuente (15 de 22 OT abiertas la tienen; las demás no), y por
 * eso es la primera frase.
 */
export function problemasDeMandarLaOT(e: {
  fecha_ejecucion: string | null;
  turno: string;
  invitados?: string[];
  fecha_cierre?: string | null;
}): string[] {
  const problemas: string[] = [];

  // Mandar una orden que ya se hizo crearía un evento futuro de algo que pasó.
  if (e.fecha_cierre) {
    problemas.push("La OT ya está cerrada: no se manda al calendario una orden que ya se hizo");
  }

  if (!e.fecha_ejecucion) {
    problemas.push("La OT no tiene fecha de ejecución: primero hay que ponerle una");
  } else if (!esFechaDelDia(e.fecha_ejecucion)) {
    problemas.push(`La fecha de ejecución «${e.fecha_ejecucion}» no es una fecha válida (tiene que ser AAAA-MM-DD)`);
  }

  if (!(TURNOS_DEL_TALLER as string[]).includes(e.turno)) {
    problemas.push(`El turno «${e.turno}» no es uno del taller: tiene que ser ${TURNOS_DEL_TALLER.join(", ")}`);
  }

  for (const correo of e.invitados ?? []) {
    if (!esCorreo(correo)) problemas.push(`El invitado «${correo}» no es un correo válido`);
  }

  return problemas;
}

/** Lo que de una OT hace falta para escribir su evento. */
export interface OTParaElEvento {
  ot_number: number;
  equipo_raw: string | null;
  equipo_code: string | null;
  sector_raw: string | null;
  especialidad: string | null;
  tipo: string | null;
  descripcion: string | null;
}

/** El texto del evento de una OT: título, descripción y lugar (el sector). */
export function datosDeLaOT(o: OTParaElEvento): { titulo: string; descripcion: string; lugar: string | null } {
  const limpio = (t: string | null) => t?.trim() || null;
  const equipo = limpio(o.equipo_raw) ?? limpio(o.equipo_code);
  const sector = limpio(o.sector_raw);

  const lineas = [`Orden de trabajo ${o.ot_number}`];
  if (equipo) lineas.push(`Equipo: ${equipo}`);
  if (sector) lineas.push(`Sector: ${sector}`);
  const especialidad = limpio(o.especialidad);
  if (especialidad) lineas.push(`Especialidad: ${especialidad}`);
  const tipo = limpio(o.tipo);
  if (tipo) lineas.push(`Tipo: ${tipo}`);
  const descripcion = limpio(o.descripcion);

  return {
    titulo: equipo ? `OT ${o.ot_number} · ${equipo}` : `OT ${o.ot_number}`,
    // El tope es el del esquema de la agenda (5000): el evento se puede editar
    // después y la descripción de una OT del formulario no tiene límite.
    descripcion: (lineas.join("\n") + (descripcion ? `\n\n${descripcion}` : "")).slice(0, 5000),
    lugar: sector,
  };
}

/**
 * De quién es el evento de una OT que todavía no tenía evento: **de la casilla
 * que generó la OT** (`created_by`) y no de quien aprieta el botón. El evento
 * pertenece a la orden y no a la agenda de nadie; lo prueban los cinco
 * invitados fijos.
 *
 * **Y si `created_by` es null, de `mantenimiento@`.** No es un caso de borde:
 * medido contra producción el 03/11/2026, de 2.349 OT sólo 91 (3,9 %) tienen
 * `created_by`, y de las 26 con fecha de ejecución futura —las que alguien va a
 * querer mandar al calendario— 18 no lo tienen: el 70 %. Quienes crearon OT
 * desde la app son `soporte.mantenimiento@` (78) y `procedimientos@` (13). Sin
 * este `coalesce`, el evento caería en el calendario personal de quien apretó el
 * botón, y `nicolaslenzetti@` o `gerencia@` terminarían siendo dueños de eventos
 * de mantenimiento. Las OT sin autor las genera el área, la casilla ya es uno
 * de los cinco invitados fijos y a nadie le cambia lo que recibe.
 *
 * Devuelve `id: null` cuando el dueño es la casilla del área: la ruta busca ese
 * usuario por correo (`dueno_id` es una referencia a `usuarios`). `delArea` dice
 * que se cayó en el default.
 */
export function duenoDelEventoDeLaOT(
  generador: { id: string; email: string | null } | null
): { id: string | null; casilla: string; delArea: boolean } {
  const casilla = generador?.email?.trim().toLowerCase();
  if (generador && casilla) return { id: generador.id, casilla, delArea: false };
  return { id: null, casilla: CASILLA_DE_MANTENIMIENTO, delArea: true };
}

/** La casilla del área, dueña de los eventos de las OT que nadie cargó en el sistema. */
export const CASILLA_DE_MANTENIMIENTO = "mantenimiento@polcecal.com";

/**
 * Lo que se le contesta a quien reenvía una OT cuyo evento divergió en Google
 * sin haber confirmado que pisa, o `null` si puede seguir.
 *
 * Reenviar **pisa** lo que una persona hizo del otro lado, y apretar el botón
 * es la decisión explícita —para una OT la verdad es la orden—, pero tiene que
 * ser **sabiendo**. Avisar después no alcanza: quien reenvía probablemente no
 * sabe que alguien lo movió. La pantalla lo muestra antes, con el horario que
 * Google tiene hoy, y manda `pisar: true`; el servidor lo vuelve a exigir
 * porque una regla que vive sólo en la pantalla no es una regla.
 */
export function faltaConfirmarElPisado(divergencia: string | null | undefined, pisar: boolean): string | null {
  if (!divergencia || pisar) return null;
  const que = divergencia === "borrado" ? "lo borraron" : "lo movieron";
  return (
    `Este evento ${que} desde Google. Mandar la orden de nuevo escribe encima lo que se hizo allá: ` +
    `hay que confirmarlo (pisar) sabiendo qué horario tiene Google hoy.`
  );
}
