import { ahoraEnArgentina, fechaEnArgentina } from "@/lib/core/fechas";
import type { Divergencia } from "./divergencia";

/**
 * Lo que la pantalla de la Agenda necesita decidir, sin red y sin React.
 *
 * Vive en `lib/` y no en el componente por la misma razón que el resto de
 * `lib/agenda/`: las pantallas no tienen tests en este repo y lo que está acá
 * son decisiones que se pueden equivocar sin que nada avise.
 */

// ── Un evento, con una sola forma ───────────────────────────────────────────

/**
 * El evento como lo muestra la pantalla. **Una sola forma**, venga de donde
 * venga: la lectura de la pantalla agrega `divergencia_vista` y saca el embed
 * de las vistas, el POST, el PATCH y destrabar devuelven la fila sin eso, y si
 * la relectura del POST falla vuelve una fila con ocho campos—, y repartir ese
 * problema por los componentes es
 * cómo uno termina con un `?.` en cada uno y un error distinto en cada caso.
 *
 * La pantalla **no usa la fila que devuelve una escritura**: después de
 * guardar, recarga la lista del servidor, que es la única que trae
 * `divergencia_vista` bien resuelta. De las respuestas de escritura sólo lee
 * lo que ninguna otra cosa le da —si salió bien, y qué avisó Google—, y eso
 * está en `leerRespuestaDeEscritura`. Lo que queda acá es entonces el único
 * punto por el que una fila entra a la pantalla.
 */
export interface EventoVista {
  id: string;
  titulo: string;
  descripcion: string | null;
  lugar: string | null;
  inicio: string;
  fin: string;
  duenoId: string;
  casilla: string;
  /** Nombre y apellido del dueño, o null si no se pudo resolver (se muestra la casilla). */
  duenoNombre: string | null;
  divergencia: Divergencia | null;
  /** ¿Quien mira ya dio por vista **esta** divergencia? Sólo apaga su campana. */
  divergenciaVista: boolean;
  googlePendiente: string | null;
  aviso: string | null;
  otId: string | null;
  turno: string | null;
  /** Correos de los invitados, en minúscula. */
  invitados: string[];
}

/** La fila cruda de `agenda_eventos` con los embeds de la lectura de la pantalla. */
export interface FilaCruda {
  id: string;
  titulo: string;
  descripcion?: string | null;
  lugar?: string | null;
  inicio: string;
  fin: string;
  dueno_id: string;
  casilla: string;
  divergencia?: string | null;
  divergencia_vista?: boolean;
  google_pendiente?: string | null;
  aviso?: string | null;
  ot_id?: string | null;
  turno?: string | null;
  agenda_invitados?: { email: string }[] | null;
  /**
   * El embed del dueño. PostgREST lo devuelve como objeto, pero **es `null`
   * para quien no puede leer a ese usuario** (RLS de `usuarios`: cada uno se ve
   * a sí mismo), que es el caso de un invitado mirando el evento de otro. Por
   * eso el nombre del dueño se completa aparte, ver `nombreDelDueno`.
   */
  usuarios?: { nombre: string | null; apellido: string | null } | { nombre: string | null; apellido: string | null }[] | null;
}

function unir(nombre: string | null | undefined, apellido: string | null | undefined): string | null {
  const t = `${nombre ?? ""} ${apellido ?? ""}`.trim();
  return t === "" ? null : t;
}

/**
 * El nombre del dueño: el del embed si vino y, si no, el del directorio de
 * usuarios que la página arma aparte. Null = mostrar la casilla.
 */
export function nombreDelDueno(
  embed: FilaCruda["usuarios"],
  duenoId: string,
  directorio: ReadonlyMap<string, string>
): string | null {
  const u = Array.isArray(embed) ? embed[0] : embed;
  return unir(u?.nombre, u?.apellido) ?? directorio.get(duenoId) ?? null;
}

export function aEventoVista(fila: FilaCruda, directorio: ReadonlyMap<string, string>): EventoVista {
  return {
    id: fila.id,
    titulo: fila.titulo,
    descripcion: fila.descripcion ?? null,
    lugar: fila.lugar ?? null,
    inicio: fila.inicio,
    fin: fila.fin,
    duenoId: fila.dueno_id,
    casilla: fila.casilla,
    duenoNombre: nombreDelDueno(fila.usuarios, fila.dueno_id, directorio),
    divergencia: fila.divergencia === "borrado" || fila.divergencia === "movido" ? fila.divergencia : null,
    divergenciaVista: fila.divergencia_vista === true,
    googlePendiente: fila.google_pendiente ?? null,
    aviso: fila.aviso ?? null,
    otId: fila.ot_id ?? null,
    turno: fila.turno ?? null,
    invitados: (fila.agenda_invitados ?? []).map((i) => i.email.toLowerCase()),
  };
}

// ── La ventana: qué se pide ─────────────────────────────────────────────────

/** Cuánto pasado se trae por defecto. */
export const DIAS_DE_HISTORIAL = 30;

/**
 * Desde cuándo se piden los eventos: los que terminan después de este instante.
 *
 * Una agenda crece sin techo, así que la pantalla no pide todo lo que la
 * persona ve desde siempre sino lo que importa: lo que viene y el último mes.
 * Quedan afuera los eventos
 * viejos; **no los divergidos**, que se piden siempre (ver `traerEventos`):
 * una alerta no puede esconderse por antigua.
 */
export function corteDelHistorial(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - DIAS_DE_HISTORIAL * 24 * 60 * 60_000).toISOString();
}

// ── Próximos y pasados ──────────────────────────────────────────────────────

/**
 * Los próximos primero (el que viene antes, arriba) y el pasado detrás (el más
 * reciente, arriba). «Próximo» es que **no terminó**: uno que está en curso
 * sigue siendo de ahora.
 */
export function separarProximosYPasados(
  eventos: readonly EventoVista[],
  ahoraMs: number
): { proximos: EventoVista[]; pasados: EventoVista[] } {
  const termino = (e: EventoVista) => Date.parse(e.fin) < ahoraMs;
  const proximos = eventos
    .filter((e) => !termino(e))
    .sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio) || a.id.localeCompare(b.id));
  const pasados = eventos
    .filter(termino)
    .sort((a, b) => Date.parse(b.inicio) - Date.parse(a.inicio) || a.id.localeCompare(b.id));
  return { proximos, pasados };
}

// ── Qué botones tiene un evento ─────────────────────────────────────────────

/**
 * Qué puede hacer con un evento quien lo mira. **Es lo único que decide qué
 * botones se dibujan**, y las rutas lo vuelven a exigir: una regla que vive sólo
 * en la pantalla no es una regla.
 */
export function permisosDelEvento(e: EventoVista, miId: string): {
  /** Editar y borrar: sólo el dueño, y nunca el evento de una OT (es de la orden). */
  puedeEditarYBorrar: boolean;
  /** Destrabar es del dueño y es lo que vuelve a atar el evento al SdG. */
  puedeDestrabar: boolean;
  /** «Volver a poner lo del sistema». Sirve para `movido` y para `borrado`, también en una OT. */
  puedeReescribir: boolean;
  /**
   * «Aceptar lo de Google». Sólo para `movido` y nunca en una OT: un borrado no
   * tiene horario que aceptar (409) y para una OT la verdad es la orden (409).
   */
  puedeAceptar: boolean;
  /** «Ya lo vi»: cualquiera que lo vea, mientras haya algo que ver y no lo haya dado por visto. */
  puedeDarPorVisto: boolean;
} {
  const esDueno = e.duenoId === miId;
  const deUnaOT = e.otId !== null;
  const divergido = e.divergencia !== null;
  return {
    puedeEditarYBorrar: esDueno && !deUnaOT,
    puedeDestrabar: esDueno && divergido,
    puedeReescribir: esDueno && divergido,
    puedeAceptar: esDueno && e.divergencia === "movido" && !deUnaOT,
    puedeDarPorVisto: divergido && !e.divergenciaVista,
  };
}

// ── La respuesta de una escritura ───────────────────────────────────────────

export interface RespuestaDeEscritura {
  /** ¿Se hizo lo pedido (2xx)? Un 201 con advertencia es `ok`: se guardó. */
  ok: boolean;
  /** El motivo cuando no salió bien. */
  error: string | null;
  /**
   * Lo que hay que mostrar aunque haya salido bien: Google no recibió el
   * cambio, o puede haberlo escrito igual. **No se traga**: un fallo de
   * escritura a Google no es un error de la pantalla, pero tampoco es nada.
   */
  advertencia: string | null;
}

/**
 * Lo que la pantalla sabe de una respuesta de POST, PATCH, DELETE, `visto` o
 * `destrabar`. Las cinco tienen forma distinta y ésta las lee a todas:
 * `{ error }` en un fallo, `{ data, google?, advertencia? }` en un éxito, y
 * `advertencia` puede faltar aunque `google.pendiente` diga que algo quedó sin
 * escribir, así que se mira también.
 */
export function leerRespuestaDeEscritura(estado: number, cuerpo: unknown): RespuestaDeEscritura {
  const c = typeof cuerpo === "object" && cuerpo !== null ? (cuerpo as Record<string, unknown>) : {};
  const ok = estado >= 200 && estado < 300;

  if (!ok) {
    const error = typeof c.error === "string" && c.error.trim() !== "" ? c.error : `No se pudo completar (error ${estado}).`;
    return { ok: false, error, advertencia: null };
  }

  const avisos: string[] = [];
  if (typeof c.advertencia === "string" && c.advertencia.trim() !== "") avisos.push(c.advertencia);

  const google = typeof c.google === "object" && c.google !== null ? (c.google as Record<string, unknown>) : null;
  if (google && avisos.length === 0) {
    if (typeof google.pendiente === "string" && google.pendiente !== "") {
      avisos.push(`Se guardó en el SdG pero no llegó a Google. Queda pendiente. Google dijo: ${google.pendiente}`);
    } else if (google.trabado === true) {
      avisos.push("Se guardó en el SdG pero no se escribió en Google: el evento está divergido.");
    } else if (google.escrito === false) {
      avisos.push("Se guardó en el SdG pero no se pudo confirmar que llegara a Google.");
    }
  }

  return { ok: true, error: null, advertencia: avisos.length > 0 ? avisos.join(" ") : null };
}

// ── Cómo se ve un horario ───────────────────────────────────────────────────

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** «mar 03/11/2026» de una fecha «YYYY-MM-DD». */
export function etiquetaDelDia(fecha: string): string {
  const [a, m, d] = fecha.split("-").map(Number);
  const dia = DIAS[new Date(Date.UTC(a, m - 1, d)).getUTCDay()];
  return `${dia} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${a}`;
}

/** El día (`YYYY-MM-DD`) y la hora (`HH:mm`) de pared de Argentina de un instante. */
export function diaYHoraDe(instanteIso: string): { dia: string; hora: string } {
  const t = new Date(instanteIso);
  return { dia: fechaEnArgentina(t), hora: ahoraEnArgentina(t).slice(11) };
}

/**
 * «mar 03/11/2026 · 08:00 a 09:30». Si el evento cruza la medianoche —no se
 * crea así desde la pantalla, pero Google lo permite y «aceptar» lo trae— se
 * dice con los dos días, que es lo único que no confunde.
 */
export function horarioDelEvento(inicioIso: string, finIso: string): string {
  const i = diaYHoraDe(inicioIso);
  const f = diaYHoraDe(finIso);
  if (i.dia === f.dia) return `${etiquetaDelDia(i.dia)} · ${i.hora} a ${f.hora}`;
  return `${etiquetaDelDia(i.dia)} ${i.hora} a ${etiquetaDelDia(f.dia)} ${f.hora}`;
}
