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

/**
 * Si Google le avisa a los invitados, o escribe en sus calendarios en silencio.
 *
 * **Es un parámetro obligatorio y no tiene valor por omisión, a propósito.** Las
 * cuatro funciones de escritura lo tenían fijo en `all`, y con eso cada OT que
 * entraba sola al calendario le mandaba un correo a cuatro personas y les hacía
 * sonar el celular. Medido el 13/11/2026: **30 eventos de OT y 120
 * invitaciones** en ocho días, de las cuales `gerencia@`, `produccion@` y
 * `nicolaslenzetti@` recibieron **30 cada uno**. El 12/11/2026 se pidió
 * sacarlas.
 *
 * Lo que NO se hizo, y es la diferencia que importa: no se sacaron los
 * invitados ni se dejó de crear el evento. El evento sigue apareciendo en los
 * cinco calendarios —que es para lo que se construyó—, sólo que llega sin
 * avisar. Lo que `none` apaga es el correo de Google; **el recordatorio propio
 * del calendario, el día del evento, no lo apaga esto** y sigue sonando.
 *
 * Sin valor por omisión porque las dos respuestas son razonables y la correcta
 * depende de quién escribe: un evento que una persona crea en la Agenda **sí**
 * tiene que avisarle a quien invitó —es el punto de invitarlo—, y uno que nace
 * de una OT no. Dejarlo opcional haría que el próximo camino de escritura
 * heredara una de las dos sin que nadie lo decidiera, que es exactamente cómo
 * esto llegó a ser `all` en los cuatro lugares.
 */
export type AvisoAInvitados = "all" | "none";

/**
 * Fechas como "2026-11-03T08:00:00", sin offset: la zona la pone ZONA_ARGENTINA.
 *
 * `id` es el que elige el SdG, y **sólo cuenta al crear** (un PATCH lo ignora).
 * Sirve para que crear se pueda reintentar sin duplicar: un POST que cortó a los
 * 30 segundos puede haberse creado igual, y el reintento (la cola de escrituras
 * fallidas) con `sendUpdates=all` le mandaría la invitación otra vez a cada
 * invitado. Con el mismo id, Google contesta 409 y `crearEvento` lo toma como
 * "ya estaba". Google exige base32hex: sólo `a`–`v` y `0`–`9` en minúscula, de 5
 * a 1024 caracteres. Un uuid sin guiones sirve (los dígitos hex son `0`–`9` y
 * `a`–`f`, todos dentro de `a`–`v`); con guiones o en mayúscula, no.
 */
export interface EventoParaGoogle {
  id?: string;
  titulo: string;
  descripcion?: string;
  lugar?: string;
  inicio: string;
  fin: string;
  /**
   * **`undefined` quiere decir cosas distintas según el verbo, y no se unifica.**
   * En un PATCH (`actualizarEvento`), omitir `attendees` es «no los toques», y
   * `[]` los borra a todos y les manda la cancelación: quien no sabe quiénes son
   * (una lectura que volvió sin filas) lo deja `undefined`. En un PUT
   * (`restaurarEvento`, que también es lo que usa `crearEvento` cuando el id ya
   * estaba), omitir es «no hay»: reemplaza el recurso entero y pierde a los
   * invitados con la misma cancelación. Por eso **quien va a hacer un PUT con
   * `undefined` tiene que leer antes los invitados de Google y reusarlos**
   * (`moverElEvento` lo hace); negarse a escribir dejaría el evento pendiente
   * para siempre, porque el reintento se encontraría con lo mismo.
   */
  invitados?: string[];
}

/** Lo que Google devuelve, ya recortado a lo que el SdG mira. */
export interface EventoEnGoogle {
  id: string;
  inicio: string;   // con offset: "2026-11-03T08:00:00-03:00"
  fin: string;
  cancelado: boolean;
  titulo?: string;
  invitados: { email: string; respuesta?: string }[];
  /**
   * Sólo lo pone `crearEvento`, y sólo en su rama del 409: ese id ya existía, así
   * que lo que vuelve **es el evento que había y no el que se pidió**. Sin esto
   * una alta nueva y un «ya estaba» son indistinguibles desde afuera, y quien
   * reintenta una escritura daría por buenos los datos viejos de Google.
   */
  yaEstaba?: true;
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
 * El 403 va aparte a propósito, porque `mensajeDeGoogle` lo explica como "la
 * carpeta no está compartida con la cuenta de servicio", que es la causa en
 * Drive y Sheets y manda a mirar donde no es. En Calendar un 403 es, por motivo
 * (`error.errors[].reason`):
 *
 *   - de cuota (`rateLimitExceeded`, `userRateLimitExceeded`, `quotaExceeded`,
 *     `dailyLimitExceeded`): Google está limitando. Con catorce calendarios
 *     sincronizando es donde aparece, y se reintenta;
 *   - `forbiddenForNonOrganizer`: se quiso tocar un evento que organiza otra
 *     persona;
 *   - `SERVICE_DISABLED` / `accessNotConfigured`: la API de Calendar no está
 *     habilitada en el proyecto. `mensajeDeGoogle` ya lo dice con el enlace para
 *     habilitarla, así que ahí se le deja la palabra;
 *   - cualquier otro: recién ahí se sugiere mirar la delegación.
 *
 * **Una delegación faltante NO se ve acá.** Falla antes, en el canje del token,
 * con `unauthorized_client` desde `oauth2.googleapis.com` (medido el 02/11/2026,
 * antes de que el administrador la autorizara), y `obtenerToken` lo tira como
 * "Google OAuth: ...". Un 403 de Calendar significa que el token se obtuvo bien;
 * achacarlo a la delegación es mandar a mirar donde no es.
 */
async function fallo(res: Response, operacion: "leer" | "escribir"): Promise<Error> {
  const cuerpo = await res.text();
  const general = mensajeDeGoogle(res.status, cuerpo, cuentaDeServicio(), operacion);
  if (res.status !== 403 || /SERVICE_DISABLED|accessNotConfigured/.test(cuerpo)) return new Error(general);

  let dijoGoogle = "";
  const motivos = new Set<string>();
  try {
    const error = JSON.parse(cuerpo)?.error ?? {};
    dijoGoogle = error.message ?? "";
    for (const e of error.errors ?? []) if (e.reason) motivos.add(e.reason);
  } catch {
    // No era JSON: se muestra el cuerpo crudo más abajo.
  }
  const textoDeGoogle = `Google dijo: ${dijoGoogle || cuerpo.slice(0, 200) || 403}`;

  if (["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded"].some((m) => motivos.has(m))) {
    return new Error(`Google está limitando el ritmo de llamadas a Calendar; se reintenta solo. ${textoDeGoogle}`);
  }
  if (motivos.has("forbiddenForNonOrganizer")) {
    return new Error(
      `Ese evento lo organiza otra persona y esta casilla no puede modificarlo (forbiddenForNonOrganizer). ${textoDeGoogle}`
    );
  }

  const cuenta = cuentaDeServicio();
  return new Error(
    `Google no dio acceso al calendario por un motivo que no es de cuota ni de organizador; ` +
      `conviene revisar la delegación de todo el dominio de ` +
      `${cuenta ? `la cuenta de servicio ${cuenta}` : "la cuenta de servicio"} ` +
      `(client ID ${CLIENT_ID_DELEGACION}) para el scope ${SCOPE_CALENDAR}. ${textoDeGoogle}`
  );
}

const comoJson = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

const ID_VALIDO = /^[a-v0-9]{5,1024}$/;

/**
 * Con `evento.id`, crear es idempotente: un 409 es que ese id ya existe, o sea
 * que el intento anterior sí entró, y se devuelve el evento leyéndolo, **con
 * `yaEstaba: true` y sin aplicarle el cuerpo que se pasó**: quien reintenta una
 * escritura tiene que pisarlo (`restaurarEvento`) o daría por buenos los datos
 * viejos de Google. Ojo: Google
 * reserva el id también de un evento borrado, así que el 409 puede traer un
 * evento con `cancelado: true`; quien llama tiene que mirarlo. Sin `id`, un 409
 * se propaga como cualquier otro error.
 */
export async function crearEvento(
  casilla: string,
  evento: EventoParaGoogle,
  avisar: AvisoAInvitados
): Promise<EventoEnGoogle> {
  if (evento.id !== undefined && !ID_VALIDO.test(evento.id)) {
    throw new Error(
      `El id de evento "${evento.id}" no es válido para Google: tiene que ser base32hex ` +
        `(sólo a-v y 0-9 en minúscula, de 5 a 1024 caracteres)`
    );
  }
  const token = await obtenerToken([SCOPE_CALENDAR], casilla);
  const res = await pedir(`${EVENTOS}?sendUpdates=${avisar}`, {
    method: "POST",
    headers: comoJson(token),
    body: JSON.stringify({ ...(evento.id ? { id: evento.id } : {}), ...cuerpoDeEvento(evento) }),
  });
  if (res.status === 409 && evento.id) {
    const existente = await leerEvento(casilla, evento.id);
    if (existente) return { ...existente, yaEstaba: true };
  }
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
 *
 * **Sobre un evento borrado miente: contesta 200 y no resucita nada.** Mirá el
 * `cancelado` de lo que devuelve: si es `true`, el cambio se guardó pero el
 * evento sigue invisible en el calendario de todos, y lo que corresponde es
 * `restaurarEvento`. Las mediciones están en `restaurarEvento`.
 */
export async function actualizarEvento(
  casilla: string,
  idEvento: string,
  evento: Partial<EventoParaGoogle>,
  avisar: AvisoAInvitados
): Promise<EventoEnGoogle> {
  const token = await obtenerToken([SCOPE_CALENDAR], casilla);
  const res = await pedir(`${EVENTOS}/${encodeURIComponent(idEvento)}?sendUpdates=${avisar}`, {
    method: "PATCH",
    headers: comoJson(token),
    body: JSON.stringify(cuerpoDeEvento(evento)),
  });
  if (!res.ok) throw await fallo(res, "escribir");
  return recortar(await res.json());
}

/**
 * Vuelve a dejar **confirmado** un evento, con el cuerpo completo: es el camino
 * para un evento que alguien borró a mano. `PUT` y no `PATCH`, con
 * `status: "confirmed"`. Recibe el evento entero (no un `Partial`) porque `PUT`
 * reemplaza el recurso, y sirve igual sobre uno vivo.
 *
 * POR QUÉ EXISTE, MEDIDO CONTRA GOOGLE EL 02/11/2026 (impersonando a una casilla
 * del dominio, sobre un evento de prueba):
 *
 *   crear                              -> 200
 *   borrar (como lo haría una persona) -> 204
 *   PATCH sobre el borrado             -> 200, y el evento queda status "cancelled"
 *   leerlo después del PATCH           -> 200, status "cancelled", con la hora NUEVA
 *   PUT con status "confirmed"         -> 200, status "confirmed"
 *
 * O sea que el PATCH sobre un borrado acepta el cambio de hora, lo guarda y **no
 * resucita nada**: informa éxito y el evento sigue invisible. Es la pantalla
 * confirmando lo que no pasó, y nada en la documentación de Google lo dice.
 *
 * Sin medir: si el PUT conserva las respuestas (`responseStatus`) de los
 * invitados de un evento que sigue vivo.
 */
export async function restaurarEvento(
  casilla: string,
  idEvento: string,
  evento: EventoParaGoogle,
  avisar: AvisoAInvitados
): Promise<EventoEnGoogle> {
  const token = await obtenerToken([SCOPE_CALENDAR], casilla);
  const res = await pedir(`${EVENTOS}/${encodeURIComponent(idEvento)}?sendUpdates=${avisar}`, {
    method: "PUT",
    headers: comoJson(token),
    body: JSON.stringify({ ...cuerpoDeEvento(evento), status: "confirmed" }),
  });
  if (!res.ok) throw await fallo(res, "escribir");
  return recortar(await res.json());
}

/**
 * Borrar es idempotente: lo que se quiere lograr es "que ese evento no esté en el
 * calendario", y tanto el 410 (`Gone`, ya estaba borrado) como el 404 (Google no
 * lo conoce) dicen exactamente eso. Los dos son éxito, no error.
 *
 * MEDIDO contra Google el 02/11/2026, impersonando a una casilla del dominio
 * sobre un evento de prueba:
 *   - borrar un evento que existe        -> 204
 *   - borrar el mismo otra vez           -> 410, reason "deleted"
 *                                           ("Resource has been deleted")
 *   - borrar un id que nunca existió     -> 404, reason "notFound"
 *   - GET de un id que nunca existió     -> 404 (por eso `leerEvento` da null)
 * Lo que **no** está medido son `abrirCanal` y `cerrarCanal`: no se pueden
 * probar desde local, porque Google valida el dominio del endpoint antes de
 * abrir el canal.
 *
 * Esto no es un caso raro sino uno que se espera frecuente: alguien borra el
 * evento a mano desde Google y después el SdG intenta borrarlo, sea por la ruta
 * de borrado o porque desapareció la OT que lo originó. Tirar ahí sería un fallo
 * inventado sobre algo que ya está como se quería.
 */
export async function borrarEvento(
  casilla: string,
  idEvento: string,
  avisar: AvisoAInvitados
): Promise<void> {
  const token = await obtenerToken([SCOPE_CALENDAR], casilla);
  const res = await pedir(`${EVENTOS}/${encodeURIComponent(idEvento)}?sendUpdates=${avisar}`, {
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
  const datos = (await res.json()) as { resourceId?: string; expiration?: string };
  const vence = new Date(Number(datos.expiration));
  if (!datos.resourceId || !datos.expiration || isNaN(vence.getTime())) {
    // Google ya abrió el canal: sin esto el error borraría el rastro y quedaría
    // un canal vivo que nadie sabe que existe ni puede cerrar.
    throw new Error(
      `El canal "${canalId}" quedó abierto en Google pero su respuesta no trajo ` +
        `${!datos.resourceId ? "resourceId" : "un expiration válido"}` +
        (datos.resourceId ? ` (resourceId ${datos.resourceId}, ciérrese con cerrarCanal)` : "; sin resourceId no se puede cerrar y se apaga solo al vencer") +
        `. Respuesta: ${JSON.stringify(datos).slice(0, 200)}`
    );
  }
  return { recursoId: datos.resourceId, vence: vence.toISOString() };
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
