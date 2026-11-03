import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { abrirCanal, cerrarCanal, leerEvento } from "@/lib/core/calendar";
import { traerTodo } from "@/lib/core/paginado";
import { queDivergio, type Divergencia } from "./divergencia";
import { parDivergencia } from "./escribirEnGoogle";

/**
 * Los canales de observación de Google Calendar: cómo se abren, cómo se
 * renuevan y qué se hace cuando Google avisa que algo cambió.
 *
 * ── GOOGLE NO DICE QUÉ CAMBIÓ, Y POR ESO NO HAY `syncToken` ─────────────────
 *
 * El aviso de un canal es «algo cambió en este calendario» y nada más: ni el
 * evento, ni el campo, ni quién. La forma habitual de seguirlo es guardar un
 * `syncToken` y pedirle a `events.list` lo que cambió desde la última vez. **Acá
 * se decidió otra cosa, a propósito**: cuando llega el aviso, el SdG relee **sus
 * propias filas futuras de esa casilla** y le pregunta a Google por cada una
 * (`revisarLaCasilla`), comparando contra `queDivergio`.
 *
 * Por qué, y por qué no hay que «mejorarlo» sin saber esto:
 *
 *  - Es **idempotente**. Un aviso repetido, perdido o fuera de orden da el mismo
 *    resultado: no hay un cursor que se pueda desfasar ni un token que venza
 *    (el `syncToken` expira y obliga a una resincronización completa, que es
 *    justo el camino que nadie ejercita).
 *  - A este volumen **sale barato**: son las decenas de eventos futuros de una
 *    casilla, no el calendario entero de la persona. `events.list` traería
 *    además todo lo que la persona tiene en su calendario y que el SdG no puso:
 *    reuniones, turnos médicos, lo que no es asunto de esta tabla.
 *  - Mira lo que importa y nada más: si el evento que el SdG escribió sigue
 *    donde lo puso. Un cambio de título, de lugar, de invitados o un RSVP no es
 *    divergencia (ver `queDivergio`), y con un `syncToken` habría que filtrarlos
 *    a mano uno por uno.
 *
 * El costo asumido, **medido y no un miedo**: cada aviso son tantas lecturas como
 * eventos futuros tenga la casilla, y las propias escrituras del SdG también
 * avisan (el eco). Al 03/11/2026 hay 26 OT con fecha de ejecución futura, así
 * que una sincronización que mueva veinte son veinte avisos, cada uno releyendo
 * unos veinte eventos: unas 400 lecturas contra una cuota de Calendar del orden
 * del millón diario. No es un problema.
 *
 * **Y por eso NO hay debounce, y no hay que ponerlo «por las dudas».** Uno en
 * memoria (una función serverless no tiene otra cosa) podría saltear un cambio
 * real que llegue justo después de una revisión, y un cambio que no se detecta
 * no vuelve a detectarse. Si la cuota algún día muerde, lo dice
 * `sincronizaciones` (`agenda / aviso_de_google`, con la casilla) y se decide
 * con el número nuevo.
 *
 * ── EL AVISO ES EL MOVIMIENTO; EL BARRIDO ES LA RED ─────────────────────────
 *
 * El webhook sólo se entera de lo que pasa mientras el canal vive. Un canal
 * recién abierto o ya vencido **no revisa lo que pasó mientras no estaba**, y un
 * cambio hecho en esa ventana no se detectaría nunca más. Por eso el cron diario
 * recorre `revisarLaCasilla` para todas las casillas (`barrerLasCasillas`): es la
 * misma idea del resumen diario de avisos, que cuenta el movimiento y los lunes
 * manda los totales, porque algo que dejó de moverse no se nombra nunca más si
 * sólo se cuenta el movimiento.
 *
 * ── UN CANAL MUERTO NO SE DISTINGUE DE UNO SANO ─────────────────────────────
 *
 * Un canal que venció deja de avisar sin error y sin ruido: desde afuera se ve
 * igual que un calendario donde nadie toca nada. Por eso `ponerAlDiaLosCanales`
 * **nunca se traga un fallo** y devuelve cada uno nombrando la casilla.
 */

// ── Qué canales hay que abrir o renovar ──────────────────────────────────────

const HORA_MS = 60 * 60_000;

/**
 * Con cuánta anticipación se renueva un canal.
 *
 * **Tiene que ser mayor que el período del cron, que es de 24 horas.** Con un
 * margen de 24 h, un canal que vence 25 h después de una corrida no se renueva
 * en ella, y a la corrida siguiente ya lleva una hora muerto: hasta un día sin
 * avisos y sin que nada lo diga. Con 48 h, aun una corrida que falle entera
 * deja otra oportunidad antes de que venza.
 *
 * El plazo que Google le pone a un canal de `events.watch` **no está medido
 * acá** (`abrirCanal` devuelve el `vence` real y es el que manda), así que este
 * número depende de que ese plazo sea bastante más largo que dos días. Si un día
 * Google devuelve uno más corto, el cron diario ya no alcanza.
 */
export const ANTICIPO_DE_RENOVACION_MS = 48 * HORA_MS;

/** Una casilla se compara en minúscula y sin espacios: así se guarda en las dos tablas. */
const comoCasilla = (texto: string) => texto.trim().toLowerCase();

/**
 * Los canales que hay que abrir o renovar hoy, en el orden de `casillas`.
 *
 * - Una casilla **sin canal** se abre (`no existe`).
 * - Un canal que **vence dentro del anticipo** (o ya venció) se renueva
 *   (`vence pronto`). Un `vence` que no se puede leer se trata igual: renovar de
 *   más no cuesta nada, y dejar vivo un canal del que no se sabe cuándo muere es
 *   exactamente lo que este diseño no acepta.
 * - Una casilla que **no está en `casillas`** (ya no es usuario, o está
 *   desactivado) no aparece: no se le renueva nada.
 */
export function canalesARenovar(
  canales: { casilla: string; vence: string }[],
  casillas: string[],
  ahora: Date
): { casilla: string; motivo: "no existe" | "vence pronto" }[] {
  const venceDe = new Map(canales.map((c) => [comoCasilla(c.casilla), c.vence]));
  const limite = ahora.getTime() + ANTICIPO_DE_RENOVACION_MS;
  const vistas = new Set<string>();
  const salida: { casilla: string; motivo: "no existe" | "vence pronto" }[] = [];

  for (const cruda of casillas) {
    const casilla = comoCasilla(cruda);
    if (!casilla || vistas.has(casilla)) continue;
    vistas.add(casilla);

    const vence = venceDe.get(casilla);
    if (vence === undefined) {
      salida.push({ casilla, motivo: "no existe" });
      continue;
    }
    const ms = new Date(vence).getTime();
    if (isNaN(ms) || ms <= limite) salida.push({ casilla, motivo: "vence pronto" });
  }
  return salida;
}

// ── La verificación del aviso ────────────────────────────────────────────────

/**
 * ¿Es de Google el aviso? Compara el `X-Goog-Channel-Token` recibido con el
 * `secreto` que se guardó al abrir ese canal.
 *
 * El endpoint es público —Google no inicia sesión—, y este secreto es lo único
 * que lo protege. Se compara en tiempo constante (sobre el hash de cada lado, que
 * iguala los largos) y **un secreto vacío no coincide con nada**, ni siquiera con
 * un token vacío.
 */
export function tokenValido(recibido: string | null | undefined, esperado: string | null | undefined): boolean {
  if (!recibido || !esperado) return false;
  const hash = (t: string) => createHash("sha256").update(t).digest();
  return timingSafeEqual(hash(recibido), hash(esperado));
}

/** Dónde llama Google. */
export const RUTA_DEL_WEBHOOK = "/api/agenda/google";

/**
 * La URL que se le registra a Google al abrir un canal, o por qué no se puede
 * armar.
 *
 * **Sale de `NEXT_PUBLIC_APP_URL` y de nada más**, sin caer en `VERCEL_URL` ni en
 * el `host` del pedido: Google llama de afuera, exige `https` y valida que el
 * dominio sea uno verificado del proyecto. Un host de preview o un `localhost`
 * se rechazan al abrir el canal con un error que no dice nada de la variable, y
 * es peor un error de Google que dice «dominio no válido» que éste, que dice
 * cuál variable mirar.
 */
export function urlDelWebhook(
  appUrl: string | undefined
): { ok: true; url: string } | { ok: false; error: string } {
  const base = (appUrl ?? "").trim().replace(/\/+$/, "");
  if (!base) {
    return {
      ok: false,
      error:
        "Falta NEXT_PUBLIC_APP_URL: los canales de Google necesitan la URL pública completa del SdG " +
        "(https://www.polcecalpolysan.app) para saber a dónde avisar.",
    };
  }
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return { ok: false, error: `NEXT_PUBLIC_APP_URL no es una URL (${base}): Google necesita una https completa.` };
  }
  if (u.protocol !== "https:" || u.hostname === "localhost" || !u.hostname.includes(".")) {
    return {
      ok: false,
      error:
        `NEXT_PUBLIC_APP_URL es ${base}, y Google sólo avisa a una dirección https pública con dominio ` +
        `verificado. Con ésta no se puede abrir ningún canal.`,
    };
  }
  return { ok: true, url: `${base}${RUTA_DEL_WEBHOOK}` };
}

// ── Abrir y renovar ──────────────────────────────────────────────────────────

export interface DeLosCanales {
  abiertos: string[];
  renovados: string[];
  /** Una frase por fallo, **con la casilla nombrada**. Vacío si todo quedó en pie. */
  fallos: string[];
}

const textoDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Abre un canal nuevo para la casilla y lo anota; si había uno, lo cierra
 * **después**. Primero el nuevo, así no hay un hueco sin avisos entre los dos.
 *
 * El canal viejo se cierra aparte y su fallo no desarma lo hecho: el nuevo ya
 * está en la tabla, y el viejo, sin fila que lo respalde, sólo recibe 401 hasta
 * que vence. Pero se informa igual.
 */
async function abrirUno(
  supabase: SupabaseClient,
  casilla: string,
  url: string,
  existente: { canal_id: string; recurso_id: string } | null
): Promise<{ error: string | null; avisoDelViejo: string | null }> {
  const canalId = randomUUID();
  const secreto = randomBytes(32).toString("hex");

  let abierto: { recursoId: string; vence: string };
  try {
    abierto = await abrirCanal(casilla, canalId, secreto, url);
  } catch (e) {
    return { error: `No se pudo abrir el canal de ${casilla}: ${textoDe(e)}`, avisoDelViejo: null };
  }

  const { error } = await supabase.from("agenda_canales").upsert(
    { casilla, canal_id: canalId, recurso_id: abierto.recursoId, secreto, vence: abierto.vence },
    { onConflict: "casilla" }
  );
  if (error) {
    // Google ya lo abrió: sin la fila nadie sabría que existe. Se lo cierra.
    let cierre = "";
    try {
      await cerrarCanal(casilla, canalId, abierto.recursoId);
    } catch (e) {
      cierre = ` Tampoco se pudo cerrar el que Google abrió (canal ${canalId}, recurso ${abierto.recursoId}): ${textoDe(e)}`;
    }
    return {
      error: `Se abrió el canal de ${casilla} pero no se pudo anotar (${error.message}), así que no sirve.${cierre}`,
      avisoDelViejo: null,
    };
  }

  if (!existente) return { error: null, avisoDelViejo: null };
  try {
    await cerrarCanal(casilla, existente.canal_id, existente.recurso_id);
    return { error: null, avisoDelViejo: null };
  } catch (e) {
    return {
      error: null,
      avisoDelViejo: `El canal nuevo de ${casilla} quedó en pie, pero no se pudo cerrar el anterior (${existente.canal_id}): ${textoDe(e)}`,
    };
  }
}

/** Las casillas de los usuarios activos: los calendarios que la Agenda mira. */
async function casillasActivas(supabase: SupabaseClient): Promise<string[]> {
  const usuarios = await traerTodo<{ email: string | null }>((desde, hasta) =>
    supabase.from("usuarios").select("email").eq("activo", true).order("id").range(desde, hasta)
  );
  return usuarios.map((u) => u.email ?? "").filter((e) => e.trim() !== "");
}

/**
 * Deja un canal vivo por cada usuario activo. **No tira por un canal**: cada
 * casilla va por su cuenta y lo que falle vuelve en `fallos`, nombrada.
 *
 * Sólo lee `usuarios` y `agenda_canales`; si eso falla sí tira, porque no hay
 * nada que decir sobre ninguna casilla.
 */
export async function ponerAlDiaLosCanales(
  supabase: SupabaseClient,
  appUrl: string | undefined,
  ahora: Date = new Date()
): Promise<DeLosCanales> {
  const r: DeLosCanales = { abiertos: [], renovados: [], fallos: [] };

  const casillas = await casillasActivas(supabase);

  const canales = await traerTodo<{ casilla: string; canal_id: string; recurso_id: string; vence: string }>(
    (desde, hasta) =>
      supabase.from("agenda_canales").select("casilla, canal_id, recurso_id, vence").order("id").range(desde, hasta)
  );

  const hoy = canalesARenovar(canales, casillas, ahora);
  if (hoy.length === 0) return r;

  const destino = urlDelWebhook(appUrl);
  if (!destino.ok) {
    // Una sola frase y no una por casilla: la causa es una sola.
    r.fallos.push(`${destino.error} Quedaron sin abrir o renovar: ${hoy.map((c) => c.casilla).join(", ")}.`);
    return r;
  }

  const actuales = new Map(canales.map((c) => [comoCasilla(c.casilla), c]));
  for (const { casilla, motivo } of hoy) {
    const existente = actuales.get(casilla) ?? null;
    const { error, avisoDelViejo } = await abrirUno(
      supabase,
      casilla,
      destino.url,
      existente ? { canal_id: existente.canal_id, recurso_id: existente.recurso_id } : null
    );
    if (error) {
      r.fallos.push(
        motivo === "vence pronto"
          ? `${error} El canal actual vence ${existente?.vence ?? "en fecha desconocida"}: después de eso esa casilla deja de avisar.`
          : error
      );
      continue;
    }
    (motivo === "no existe" ? r.abiertos : r.renovados).push(casilla);
    if (avisoDelViejo) r.fallos.push(avisoDelViejo);
  }
  return r;
}

// ── Revisar una casilla cuando Google avisa ─────────────────────────────────

interface FilaARevisar {
  id: string;
  google_event_id: string;
  inicio_escrito: string;
  fin_escrito: string;
}

/**
 * Revisa los eventos futuros de una casilla contra Google y **anota** los que
 * divergieron. Devuelve **sólo los que acaban de divergir**, que es lo que hay
 * que avisar: uno que ya estaba divergido no vuelve a aparecer.
 *
 * Qué entra: los eventos de esa casilla que ya están en Google
 * (`google_event_id`), que el SdG ya escribió alguna vez (`inicio_escrito` —sin
 * él no hay contra qué comparar—), que **no están ya divergidos**, y que no
 * terminaron. Lo de «no están ya divergidos» importa: volver a marcar uno
 * cambiaría su `divergencia_el`, y eso es justamente lo que hace reaparecer la
 * alerta que alguien ya dio por vista.
 *
 * **Sólo borrado y movido** (ver `queDivergio`): un RSVP, un título cambiado o un
 * invitado de más no cuentan, y no se los vuelve a mirar acá.
 *
 * Un evento borrado en Google **no devuelve 404 sino 200 con `cancelado`** (medido
 * el 02/11/2026): `leerEvento` lo entrega como cancelado, y un `null` es un id que
 * Google no conoce. `queDivergio` toma los dos como «borrado».
 *
 * **La anotación es condicional**: sólo escribe si la fila sigue sin divergencia
 * y con los mismos `inicio_escrito` y `fin_escrito` que se leyeron. Entre la
 * lectura de la fila y la de Google, una escritura propia puede haber movido el
 * evento y actualizado esas dos columnas; comparar contra las viejas daría un
 * «movido» que no existe, y eso es una notificación al teléfono de cinco personas
 * por nada. Si no coincide, no se escribe nada: la escritura propia ya trae su
 * propio aviso, que vuelve a revisar con lo nuevo. Es también lo que deja
 * correr varias revisiones juntas (diez avisos seguidos de Google) sin que se
 * pisen.
 *
 * **Un fallo no corta la revisión**: se agrega a `fallos`, con el evento y lo que
 * dijo Google sin traducir, y se sigue con el resto. Quien llama tiene que
 * registrarlos. Tira sólo si no puede leer la base, porque entonces no se miró
 * nada.
 */
export async function revisarLaCasilla(
  supabase: SupabaseClient,
  casilla: string,
  fallos: string[] = [],
  ahora: Date = new Date()
): Promise<{ evento_id: string; divergencia: Divergencia }[]> {
  const filas = await traerTodo<FilaARevisar>((desde, hasta) =>
    supabase
      .from("agenda_eventos")
      .select("id, google_event_id, inicio_escrito, fin_escrito")
      .eq("casilla", casilla)
      .not("google_event_id", "is", null)
      .not("inicio_escrito", "is", null)
      .is("divergencia", null)
      .gte("fin", ahora.toISOString())
      .order("id")
      .range(desde, hasta)
      .returns<FilaARevisar[]>()
  );

  const nuevas: { evento_id: string; divergencia: Divergencia }[] = [];
  const marca = ahora.toISOString();

  for (const f of filas) {
    let enGoogle;
    try {
      enGoogle = await leerEvento(casilla, f.google_event_id);
    } catch (e) {
      fallos.push(`${casilla}: no se pudo leer de Google el evento ${f.id}: ${textoDe(e)}`);
      continue;
    }

    const divergencia = queDivergio({ inicio: f.inicio_escrito, fin: f.fin_escrito }, enGoogle);
    if (!divergencia) continue;

    // Un reintento: es el `update` que decide si alguien se entera, y un
    // parpadeo de la base no puede ser lo que lo pierda.
    let error: string | null = null;
    let anotadas: unknown[] | null = null;
    for (let intento = 0; intento < 2 && anotadas === null; intento++) {
      const r = await supabase
        .from("agenda_eventos")
        .update(parDivergencia(divergencia, marca))
        .eq("id", f.id)
        .is("divergencia", null)
        .eq("inicio_escrito", f.inicio_escrito)
        .eq("fin_escrito", f.fin_escrito)
        .select("id");
      if (r.error) error = r.error.message;
      else anotadas = r.data ?? [];
    }
    if (anotadas === null) {
      fallos.push(
        `${casilla}: el evento ${f.id} ${divergencia === "borrado" ? "lo borraron" : "lo movieron"} en Google ` +
          `pero no se pudo anotar, ni en dos intentos (${error}). Se vuelve a ver con el próximo aviso de Google.`
      );
      continue;
    }
    if (anotadas.length === 0) continue; // cambió mientras tanto: ver el docstring

    nuevas.push({ evento_id: f.id, divergencia });
  }
  return nuevas;
}

// ── El barrido diario ───────────────────────────────────────────────────────

export interface DelBarrido {
  casillas: number;
  /** Las que acaban de divergir. Ya están anotadas en la fila, igual que las del aviso de Google. */
  divergencias: { casilla: string; evento_id: string; divergencia: Divergencia }[];
  /** Una frase por fallo, con la casilla nombrada. */
  fallos: string[];
}

/**
 * Revisa **todas** las casillas activas contra Google, como si cada una hubiera
 * avisado: es la red que cubre lo que un canal no vio (ver el encabezado). Escribe
 * la divergencia exactamente igual que el webhook, porque usa la misma
 * `revisarLaCasilla`, así que **no hace falta nada de la Tarea 10 para que
 * quede**: la campana la levanta de la fila.
 *
 * **Nunca tira por una casilla**: cada una va por su cuenta y lo que falle vuelve
 * en `fallos` nombrándola. Con `presupuestoMs` corta antes de que Vercel mate la
 * función, y **lo dice**: las casillas que no se alcanzaron a mirar van nombradas.
 * El orden es el de `usuarios`, así que si se cortara seguido se miraría siempre
 * a las mismas primero y habría que rotarlas. Tira sólo si no puede leer
 * `usuarios`.
 */
export async function barrerLasCasillas(
  supabase: SupabaseClient,
  ahora: Date = new Date(),
  presupuestoMs: number = 120_000
): Promise<DelBarrido> {
  const casillas = [...new Set((await casillasActivas(supabase)).map(comoCasilla))];
  const r: DelBarrido = { casillas: 0, divergencias: [], fallos: [] };
  const empezo = Date.now();

  for (let i = 0; i < casillas.length; i++) {
    const casilla = casillas[i];
    if (Date.now() - empezo > presupuestoMs) {
      r.fallos.push(`Se cortó el barrido por tiempo: no se miraron ${casillas.slice(i).join(", ")}.`);
      break;
    }
    r.casillas++;
    try {
      for (const d of await revisarLaCasilla(supabase, casilla, r.fallos, ahora)) {
        r.divergencias.push({ casilla, ...d });
      }
    } catch (e) {
      r.fallos.push(`${casilla}: no se pudo revisar en el barrido: ${textoDe(e)}`);
    }
  }
  return r;
}
