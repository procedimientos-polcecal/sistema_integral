import {
  crearEvento, actualizarEvento, restaurarEvento, borrarEvento, leerEvento,
  type EventoParaGoogle, type EventoEnGoogle,
} from "@/lib/core/calendar";
import { instanteDe } from "./evento";
import type { Divergencia } from "./divergencia";

/**
 * Escribir un evento en Google y decidir **qué anotar en la fila** después.
 *
 * Todo lo que decide algo en las rutas de la Agenda vive acá, porque las rutas
 * no tienen tests en este repo. Las rutas leen, llaman y guardan.
 */

export type AccionEnGoogle = "crear" | "actualizar" | "restaurar" | "borrar";

export interface FilaParaGoogle {
  casilla: string;
  google_event_id: string | null;
  inicio: string;
  fin: string;
}

/**
 * Lo que Google dejó, listo para anotar. Los tres primeros salen **de lo que
 * Google devolvió** y no de lo que se mandó: `inicio_escrito` / `fin_escrito`
 * son lo único que separa el eco de una escritura propia de un cambio hecho por
 * una persona, y esa comparación es contra lo que Google tiene (con su offset).
 *
 * `pendiente` es el fallo, **con lo que dijo Google sin traducir**. `divergencia`
 * sólo sale de `actualizar`: el cambio fue aceptado pero el evento estaba
 * borrado (ver abajo), y eso no es una escritura que salió bien.
 */
export interface ResultadoDeEscritura {
  google_event_id?: string;
  inicio_escrito?: string;
  fin_escrito?: string;
  pendiente?: string;
  divergencia?: Divergencia;
}

/** El mensaje de un error, sin tocarlo. */
function textoDelFallo(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Lo que Google devolvió como lo que hay que anotar. **Los dos o ninguno**: un
 * `inicio_escrito` sin su `fin_escrito` haría que el próximo aviso de Google
 * comparara contra media escritura y diera «movido» sobre algo que no se movió.
 */
function comoEscrito(e: EventoEnGoogle): ResultadoDeEscritura {
  if (!e.inicio || !e.fin) {
    return {
      google_event_id: e.id,
      pendiente:
        `Google aceptó la escritura pero devolvió el evento sin horario, así que no se puede ` +
        `anotar lo escrito: ${JSON.stringify(e).slice(0, 200)}`,
    };
  }
  return { google_event_id: e.id, inicio_escrito: e.inicio, fin_escrito: e.fin };
}

/**
 * Escribe un evento en Google. **Nunca tira**: un fallo vuelve como `pendiente`
 * con lo que dijo Google, sin traducir, y quien llama lo guarda y se lo dice a
 * la persona. Un diagnóstico que no se distingue de otro no es un diagnóstico.
 *
 * LAS CUATRO ACCIONES
 *
 * - `crear` usa el `id` del evento (`evento.id`, o el `google_event_id` de la
 *   fila si ya había uno): con id propio crear es idempotente y se puede
 *   reintentar. Google reserva el id **también de un evento borrado**: si el
 *   409 trae uno cancelado, se restaura, porque lo que se pidió es un evento
 *   vivo.
 * - `actualizar` es un `PATCH`, y **sobre un evento borrado miente**: contesta
 *   200 y lo deja cancelado. Si lo que vuelve está cancelado, no es una
 *   escritura que salió bien sino una divergencia por borrado
 *   (`divergencia: "borrado"`, sin `inicio_escrito`: lo que Google tiene no es
 *   lo que se quiso escribir). Es la carrera entre «alguien lo borró» y «el
 *   aviso de Google todavía no llegó».
 * - `restaurar` es el `PUT` con `status: confirmed`, el único camino que
 *   resucita un evento borrado. Si Google igual lo devuelve cancelado, es un
 *   fallo y no un éxito: la pantalla no puede decir «listo» sobre un evento
 *   que nadie ve.
 * - `borrar` es idempotente (404 y 410 son éxito) y no devuelve nada que
 *   anotar: sin `id` no hay nada que borrar.
 *
 * `fila.inicio` y `fila.fin` completan la forma de la fila y no se usan acá:
 * lo que se escribe es lo que trae `evento`.
 */
export async function escribirEnGoogle(
  accion: AccionEnGoogle,
  fila: FilaParaGoogle,
  evento?: EventoParaGoogle
): Promise<ResultadoDeEscritura> {
  try {
    if (accion === "borrar") {
      const id = fila.google_event_id ?? evento?.id;
      if (id) await borrarEvento(fila.casilla, id);
      return {};
    }

    if (!evento) {
      return { pendiente: `Falta el evento para ${accion} en Google: es un error del SdG, no de Google` };
    }

    if (accion === "crear") {
      const id = evento.id ?? fila.google_event_id ?? undefined;
      const creado = await crearEvento(fila.casilla, { ...evento, id });
      if (!creado.cancelado) return comoEscrito(creado);
      return await restaurar(fila.casilla, creado.id, evento);
    }

    const id = fila.google_event_id;
    if (!id) {
      return { pendiente: `El evento todavía no está en Google, así que no hay nada que ${accion}` };
    }

    if (accion === "restaurar") return await restaurar(fila.casilla, id, evento);

    const actualizado = await actualizarEvento(fila.casilla, id, evento);
    if (actualizado.cancelado) return { google_event_id: id, divergencia: "borrado" };
    return comoEscrito(actualizado);
  } catch (e) {
    // Nunca vacío: `pendiente` vacío se leería como «no hubo fallo».
    return { pendiente: textoDelFallo(e) || SIN_MENSAJE };
  }
}

async function restaurar(casilla: string, id: string, evento: EventoParaGoogle): Promise<ResultadoDeEscritura> {
  const r = await restaurarEvento(casilla, id, evento);
  if (r.cancelado) {
    return {
      google_event_id: id,
      pendiente: "Google devolvió el evento todavía cancelado después de pedirle que lo confirmara",
    };
  }
  return comoEscrito(r);
}

/**
 * LOS TRES PARES ATADOS Y LAS ÚNICAS TRES FUNCIONES QUE LOS ESCRIBEN
 *
 * `google_pendiente` / `google_pendiente_el`, `divergencia` / `divergencia_el`
 * e `inicio_escrito` / `fin_escrito` tienen un `check` en la base: las dos
 * columnas en null o las dos con valor. Nadie más arma estas columnas a mano:
 * ni las rutas ni `destrabar`.
 *
 * Importa más de lo que parece porque el `update` que guarda un pendiente es el
 * que corre **cuando Google ya falló**, el camino menos ejercitado de todos. Si
 * ahí se escribe media columna, la violación del `check` se come el diagnóstico
 * original de Google y no queda forma de saber qué pasó. Mismo criterio que
 * `lib/mantenimiento/pendienteDelAviso.ts`: una función arma el par entero, con
 * su test.
 */

/** El fallo de una escritura, o `null` para limpiarlo. Un texto vacío no es «sin fallo»: se anota igual. */
export function parPendiente(texto: string | null, ahora: string) {
  if (texto === null) return { google_pendiente: null, google_pendiente_el: null };
  return { google_pendiente: texto || SIN_MENSAJE, google_pendiente_el: ahora };
}

/** La divergencia con su fecha, o `null` para limpiarla. */
export function parDivergencia(divergencia: Divergencia | null, ahora: string) {
  if (divergencia === null) return { divergencia: null, divergencia_el: null };
  return { divergencia, divergencia_el: ahora };
}

/**
 * Lo último que el SdG escribió. **Los dos o ninguno**: con uno solo se
 * devuelve `{}` y no se toca nada, porque anotar la mitad haría que el próximo
 * aviso de Google se compare contra media escritura.
 */
export function parEscrito(inicio: string | undefined, fin: string | undefined) {
  return inicio && fin ? { inicio_escrito: inicio, fin_escrito: fin } : {};
}

const SIN_MENSAJE = "Google falló sin dar un mensaje";

/**
 * Las columnas de la fila que hay que escribir después de hablar con Google.
 *
 * - Con `pendiente`: se anota el fallo y **no** se toca lo escrito —no hubo
 *   escritura—.
 * - Sin él: se limpia el pendiente (la escritura que faltaba ya salió) y, según
 *   el caso, se anota una divergencia o lo escrito.
 */
export function columnasDespuesDeEscribir(
  r: ResultadoDeEscritura,
  ahora: string
): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  if (r.google_event_id) c.google_event_id = r.google_event_id;

  if (r.pendiente !== undefined) return { ...c, ...parPendiente(r.pendiente, ahora) };

  Object.assign(c, parPendiente(null, ahora));
  if (r.divergencia) Object.assign(c, parDivergencia(r.divergencia, ahora));
  else Object.assign(c, parEscrito(r.inicio_escrito, r.fin_escrito));
  return c;
}

/**
 * Lo que hay que decirle a quien hizo la acción cuando la escritura a Google no
 * quedó bien, o `null` si quedó bien. **La respuesta de la ruta lo lleva
 * siempre**: el evento está guardado en el SdG y eso, sin esta frase, parecería
 * que también llegó al calendario de los invitados.
 *
 * `que` es lo que sí se guardó («El evento», «El cambio»). Lleva lo que dijo
 * Google sin traducir, que es lo único que permite saber qué pasó.
 */
export function advertenciaDeLaEscritura(r: ResultadoDeEscritura, que: string): string | null {
  if (r.pendiente) {
    return (
      `${que} se guardó en el SdG pero no llegó a Google, así que nadie lo ve en su calendario todavía. ` +
      `Queda pendiente y se reintenta. Google dijo: ${r.pendiente}`
    );
  }
  if (r.divergencia === "borrado") {
    return (
      `${que} se guardó en el SdG, pero ese evento estaba borrado en Google y sigue invisible en el ` +
      `calendario de todos. Quedó marcado como divergido: destrabalo reescribiéndolo para volver a ponerlo.`
    );
  }
  return null;
}

// ── Destrabar un evento divergido ────────────────────────────────

/** Lo que de la fila hace falta para destrabar. */
export interface FilaDivergida extends FilaParaGoogle {
  divergencia: Divergencia;
}

export type ResultadoDeDestrabar =
  /** `columnas` es lo que se escribe en la fila: deja `divergencia` y `divergencia_el` en null. */
  | { ok: true; columnas: Record<string, unknown> }
  /**
   * No se destrabó. `estado` es el HTTP de la respuesta: 409 es que lo pedido
   * no se puede hacer así, 502 es que Google falló. `columnas`, si viene, se
   * escribe igual: el fallo de una escritura se guarda con lo que dijo Google.
   */
  | { ok: false; estado: 409 | 502; error: string; columnas?: Record<string, unknown> };

/** Destrabado: sin divergencia y sin pendiente, cada par entero (ver `parDivergencia` y `parPendiente`). */
function destrabada(ahora: string) {
  return { ...parDivergencia(null, ahora), ...parPendiente(null, ahora) };
}

/**
 * Vuelve a atar al SdG un evento que divergió. Sin esto un evento divergido
 * queda muerto para siempre: la sincronización deja de escribirlo.
 *
 * - **`reescribir`**: Google pasa a decir lo que dice el SdG. Para una
 *   divergencia `borrado` se usa `restaurarEvento` y **nunca**
 *   `actualizarEvento`: un `PATCH` sobre un evento borrado contesta 200 y lo
 *   deja cancelado, o sea que la pantalla diría que funcionó y el evento
 *   seguiría invisible en el calendario de todos. Para `movido` se usa el
 *   `PATCH`; si ahí resulta que entre tanto lo borraron, se restaura. La fila
 *   conserva sus `inicio`/`fin` y se anota como escrito lo que Google devolvió.
 * - **`aceptar`**: lo de Google pasa a ser la verdad. Trae su `inicio`/`fin` a
 *   la fila y los marca como lo escrito. **Sólo tiene sentido para `movido`**:
 *   un evento que Google borró no tiene horario que traer, y «aceptar» un
 *   borrado sería borrar la fila, que es otra decisión y tiene su propia ruta.
 *
 * Nunca tira.
 */
export async function destrabar(
  como: "reescribir" | "aceptar",
  fila: FilaDivergida,
  evento: EventoParaGoogle
): Promise<ResultadoDeDestrabar> {
  return como === "reescribir" ? reescribir(fila, evento) : aceptar(fila);
}

async function reescribir(fila: FilaDivergida, evento: EventoParaGoogle): Promise<ResultadoDeDestrabar> {
  const sinId = { ...fila, google_event_id: fila.google_event_id ?? evento.id ?? null };

  let r = await escribirEnGoogle(fila.divergencia === "borrado" ? "restaurar" : "actualizar", sinId, evento);
  // Era un `movido` y mientras tanto lo borraron: el PATCH no lo resucita.
  if (r.divergencia === "borrado") r = await escribirEnGoogle("restaurar", sinId, evento);

  if (r.pendiente || !r.inicio_escrito || !r.fin_escrito) {
    return {
      ok: false,
      estado: 502,
      error:
        `No se pudo reescribir el evento en Google, y sigue sin destrabar. ` +
        `Google dijo: ${r.pendiente ?? "una respuesta sin horario"}`,
      columnas: columnasDespuesDeEscribir(
        { ...r, pendiente: r.pendiente ?? "Google contestó sin horario" },
        new Date().toISOString()
      ),
    };
  }
  return {
    ok: true,
    columnas: {
      google_event_id: r.google_event_id ?? sinId.google_event_id,
      ...parEscrito(r.inicio_escrito, r.fin_escrito),
      ...destrabada(new Date().toISOString()),
    },
  };
}

async function aceptar(fila: FilaDivergida): Promise<ResultadoDeDestrabar> {
  if (fila.divergencia === "borrado") {
    return {
      ok: false,
      estado: 409,
      error:
        "Google borró este evento, así que no hay horario que aceptar. " +
        "Para volver a ponerlo, reescribilo desde el SdG; para sacarlo, borralo.",
    };
  }
  if (!fila.google_event_id) {
    return { ok: false, estado: 409, error: "El evento no tiene id en Google: no hay nada que leer de allá." };
  }

  let enGoogle: EventoEnGoogle | null;
  try {
    enGoogle = await leerEvento(fila.casilla, fila.google_event_id);
  } catch (e) {
    return {
      ok: false,
      estado: 502,
      error: `No se pudo leer el evento de Google, y sigue sin destrabar. Google dijo: ${textoDelFallo(e)}`,
    };
  }

  if (!enGoogle || enGoogle.cancelado) {
    return {
      ok: false,
      estado: 409,
      error:
        "Mientras tanto Google borró el evento, así que no hay horario que aceptar. " +
        "Reescribilo desde el SdG para volver a ponerlo, o borralo.",
    };
  }

  const inicio = instanteDe(enGoogle.inicio);
  const fin = instanteDe(enGoogle.fin);
  if (!inicio?.conZona || !fin?.conZona) {
    return {
      ok: false,
      estado: 409,
      error:
        `Google dejó el evento sin hora precisa (inicio «${enGoogle.inicio}», fin «${enGoogle.fin}»), ` +
        `por ejemplo como evento de día completo, y la Agenda no maneja eventos sin hora. ` +
        `Reescribilo desde el SdG.`,
    };
  }
  if (fin.ms <= inicio.ms) {
    return {
      ok: false,
      estado: 409,
      error: "El horario que tiene Google termina antes de empezar, así que no se puede aceptar. Reescribilo desde el SdG.",
    };
  }

  return {
    ok: true,
    columnas: {
      inicio: enGoogle.inicio,
      fin: enGoogle.fin,
      ...parEscrito(enGoogle.inicio, enGoogle.fin),
      ...destrabada(new Date().toISOString()),
    },
  };
}
