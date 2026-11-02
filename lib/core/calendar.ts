/**
 * El cliente de Google Calendar: lo único que habla con la API de eventos.
 *
 * Todas las llamadas van al calendario `primary` **de la casilla que se
 * impersona** (`obtenerToken(scopes, casilla)`): la cuenta de servicio escribe en
 * el calendario de la persona como si fuera ella, con delegación en todo el
 * dominio.
 *
 * DOS COSAS MEDIDAS CONTRA GOOGLE EL 02/11/2026 Y QUE NO SE DEDUCEN DEL CÓDIGO
 *
 * 1. **La zona va explícita en cada evento.** Nueve de los catorce calendarios
 *    del dominio están configurados en `UTC` y no en Argentina. Un evento sin
 *    `timeZone` se interpreta en la zona del calendario de quien lo recibe, así
 *    que una OT del turno 4-12 le caería a esas nueve personas a la una de la
 *    mañana, sin error y sin aviso. Por eso `start.timeZone` y `end.timeZone`
 *    salen siempre, con `dateTime` **sin offset**: la zona la pone
 *    `ZONA_ARGENTINA`. Lo que Google devuelve sí trae offset
 *    (`2026-11-03T08:00:00-03:00`).
 *
 * 2. **Un evento borrado no desaparece.** El `GET` de un evento borrado
 *    devuelve **HTTP 200** con `"status": "cancelled"`: buscar un 404 no detecta
 *    nada. El 404 existe igual, pero sólo para un id que nunca existió, y
 *    `leerEvento` lo devuelve como `null`. Son dos casos distintos y quien llama
 *    tiene que poder distinguirlos: `cancelado: true` es "alguien lo borró",
 *    `null` es "ese id no es de nadie".
 *
 * `sendUpdates=all` va en todas las escrituras: es lo que hace que al invitado
 * le llegue el correo de la invitación, de la modificación o de la cancelación.
 * Sin eso el evento aparece en su calendario pero nadie le avisa.
 *
 * Un fallo de escritura se propaga con lo que dijo Google, sin traducir
 * (`mensajeDeGoogle`): nunca se traga con un `console.warn`.
 */

import {
  obtenerToken, SCOPE_CALENDAR, mensajeDeGoogle, cuentaDeServicio,
} from "@/lib/core/google";

export const ZONA_ARGENTINA = "America/Argentina/Buenos_Aires";

const BASE = "https://www.googleapis.com/calendar/v3";
const EVENTOS = `${BASE}/calendars/primary/events`;

/** Fechas como "2026-11-03T08:00:00", sin offset: la zona la pone ZONA_ARGENTINA. */
export interface EventoParaGoogle {
  titulo: string;
  descripcion?: string;
  lugar?: string;
  inicio: string;
  fin: string;
  invitados: string[];
}

/** Lo que Google devuelve, ya recortado a lo que el SdG mira. */
export interface EventoEnGoogle {
  id: string;
  inicio: string;   // con offset: "2026-11-03T08:00:00-03:00"
  fin: string;
  cancelado: boolean;
  titulo?: string;
  invitados: { email: string; respuesta?: string }[];
}

/** Misma cota que `lib/core/sheets.ts`; ver el porqué en su `CORTE_MS`. */
const CORTE_MS = 30_000;

/**
 * `fetch` con cota de tiempo y un mensaje que se distingue.
 *
 * Sin `AbortSignal`, un Google que acepta la conexión y no contesta deja la
 * llamada colgada hasta que la plataforma mata la función, y eso no es un error
 * que nadie pueda leer. Con la cota, el fallo llega con motivo.
 */
async function pedir(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(CORTE_MS) });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Error(
        `Google no contestó en ${CORTE_MS / 1000} segundos y se cortó la espera; ` +
          `se reintenta solo`,
        { cause: e }
      );
    }
    throw e;
  }
}

/** Un evento en el formato de la API. Sólo lleva lo que `evento` trae: sirve para crear y para parchar. */
function cuerpoDeEvento(evento: Partial<EventoParaGoogle>): Record<string, unknown> {
  const cuerpo: Record<string, unknown> = {};
  if (evento.titulo !== undefined) cuerpo.summary = evento.titulo;
  if (evento.descripcion !== undefined) cuerpo.description = evento.descripcion;
  if (evento.lugar !== undefined) cuerpo.location = evento.lugar;
  if (evento.inicio !== undefined) cuerpo.start = { dateTime: evento.inicio, timeZone: ZONA_ARGENTINA };
  if (evento.fin !== undefined) cuerpo.end = { dateTime: evento.fin, timeZone: ZONA_ARGENTINA };
  if (evento.invitados !== undefined) cuerpo.attendees = evento.invitados.map((email) => ({ email }));
  return cuerpo;
}

interface EventoCrudo {
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email: string; responseStatus?: string }[];
}

/**
 * Un evento cancelado puede venir sin `start` ni `end`: se leen con vacío en vez
 * de reventar, porque justamente ése es el caso que hay que poder leer.
 */
function recortar(crudo: EventoCrudo): EventoEnGoogle {
  return {
    id: crudo.id,
    inicio: crudo.start?.dateTime ?? crudo.start?.date ?? "",
    fin: crudo.end?.dateTime ?? crudo.end?.date ?? "",
    cancelado: crudo.status === "cancelled",
    titulo: crudo.summary,
    invitados: (crudo.attendees ?? []).map((a) => ({ email: a.email, respuesta: a.responseStatus })),
  };
}

/** El client ID de la cuenta de servicio, el que figura en la delegación de dominio del admin de Google. */
const CLIENT_ID_DELEGACION = "101499089090401417948";

/**
 * El error de una llamada que falló.
 *
 * El 403 va aparte a propósito. `mensajeDeGoogle` lo explica como "la carpeta no
 * está compartida con la cuenta de servicio", que es la causa en Drive y Sheets
 * y manda a mirar donde no es: en Calendar la cuenta entra impersonando, así que
 * un 403 es que **la delegación de todo el dominio** no cubre el scope o el
 * client ID. La frase propia dice eso, y detrás va el texto de Google tal cual.
 *
 * Una excepción: si la API de Calendar no está habilitada en el proyecto, el 403
 * trae `SERVICE_DISABLED` y `mensajeDeGoogle` ya sabe decirlo con el enlace para
 * habilitarla; ahí la pista de la delegación sería la equivocada.
 */
async function fallo(res: Response, operacion: "leer" | "escribir"): Promise<Error> {
  const cuerpo = await res.text();
  const general = mensajeDeGoogle(res.status, cuerpo, cuentaDeServicio(), operacion);
  if (res.status !== 403 || /SERVICE_DISABLED|accessNotConfigured/.test(cuerpo)) return new Error(general);

  let dijoGoogle = "";
  try {
    dijoGoogle = JSON.parse(cuerpo)?.error?.message ?? "";
  } catch {
    // No era JSON: se muestra el cuerpo crudo más abajo.
  }
  const cuenta = cuentaDeServicio();
  return new Error(
    `Google no dio acceso al calendario: lo más probable es que falte la delegación de ` +
      `todo el dominio para ${cuenta ? `la cuenta de servicio ${cuenta}` : "la cuenta de servicio"} ` +
      `(client ID ${CLIENT_ID_DELEGACION}) con el scope ${SCOPE_CALENDAR}. ` +
      `Google dijo: ${dijoGoogle || cuerpo.slice(0, 200) || 403}`
  );
}

const comoJson = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

export async function crearEvento(casilla: string, evento: EventoParaGoogle): Promise<EventoEnGoogle> {
  const token = await obtenerToken([SCOPE_CALENDAR], casilla);
  const res = await pedir(`${EVENTOS}?sendUpdates=all`, {
    method: "POST",
    headers: comoJson(token),
    body: JSON.stringify(cuerpoDeEvento(evento)),
  });
  if (!res.ok) throw await fallo(res, "escribir");
  return recortar(await res.json());
}

/**
 * `null` sólo si Google no conoce el id (404). Un evento borrado **no** es null:
 * vuelve con `cancelado: true`; ver el encabezado del archivo.
 */
export async function leerEvento(casilla: string, idEvento: string): Promise<EventoEnGoogle | null> {
  const token = await obtenerToken([SCOPE_CALENDAR], casilla);
  const res = await pedir(`${EVENTOS}/${encodeURIComponent(idEvento)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw await fallo(res, "leer");
  return recortar(await res.json());
}

/**
 * PATCH: sólo viaja lo que se pasa. Los invitados, si se pasan, **reemplazan** la
 * lista entera (así lo hace Google con `attendees`), no se suman.
 */
export async function actualizarEvento(
  casilla: string,
  idEvento: string,
  evento: Partial<EventoParaGoogle>
): Promise<EventoEnGoogle> {
  const token = await obtenerToken([SCOPE_CALENDAR], casilla);
  const res = await pedir(`${EVENTOS}/${encodeURIComponent(idEvento)}?sendUpdates=all`, {
    method: "PATCH",
    headers: comoJson(token),
    body: JSON.stringify(cuerpoDeEvento(evento)),
  });
  if (!res.ok) throw await fallo(res, "escribir");
  return recortar(await res.json());
}

/**
 * Borrar es idempotente: lo que se quiere lograr es "que ese evento no esté en el
 * calendario", y tanto el 410 (`Gone`, ya estaba borrado) como el 404 (Google no
 * lo conoce) dicen exactamente eso. Los dos son éxito, no error.
 *
 * Esto no es un caso raro sino uno que se espera frecuente: alguien borra el
 * evento a mano desde Google y después el SdG intenta borrarlo, sea por la ruta
 * de borrado o porque desapareció la OT que lo originó. Tirar ahí sería un fallo
 * inventado sobre algo que ya está como se quería.
 */
export async function borrarEvento(casilla: string, idEvento: string): Promise<void> {
  const token = await obtenerToken([SCOPE_CALENDAR], casilla);
  const res = await pedir(`${EVENTOS}/${encodeURIComponent(idEvento)}?sendUpdates=all`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404 || res.status === 410) return;
  if (!res.ok) throw await fallo(res, "escribir");
}

/**
 * Abre un canal de notificaciones (`events.watch`) sobre el calendario de la
 * casilla. Google avisa por POST a `url` con `secreto` en el header
 * `X-Goog-Channel-Token`. `vence` vuelve como ISO: Google lo manda en
 * milisegundos de época, como texto.
 */
export async function abrirCanal(
  casilla: string,
  canalId: string,
  secreto: string,
  url: string
): Promise<{ recursoId: string; vence: string }> {
  const token = await obtenerToken([SCOPE_CALENDAR], casilla);
  const res = await pedir(`${EVENTOS}/watch`, {
    method: "POST",
    headers: comoJson(token),
    body: JSON.stringify({ id: canalId, type: "web_hook", address: url, token: secreto }),
  });
  if (!res.ok) throw await fallo(res, "escribir");
  const datos = (await res.json()) as { resourceId: string; expiration: string };
  return { recursoId: datos.resourceId, vence: new Date(Number(datos.expiration)).toISOString() };
}

/**
 * Cierra un canal. Recibe la casilla porque el canal se abrió impersonándola y
 * `channels.stop` se autoriza igual: un token sin `sub` no ve los canales de nadie.
 */
export async function cerrarCanal(casilla: string, canalId: string, recursoId: string): Promise<void> {
  const token = await obtenerToken([SCOPE_CALENDAR], casilla);
  const res = await pedir(`${BASE}/channels/stop`, {
    method: "POST",
    headers: comoJson(token),
    body: JSON.stringify({ id: canalId, resourceId: recursoId }),
  });
  if (!res.ok) throw await fallo(res, "escribir");
}
