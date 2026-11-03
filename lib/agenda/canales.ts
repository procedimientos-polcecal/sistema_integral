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

// ── El presupuesto de una corrida del cron ───────────────────────────────────

/**
 * **Un solo presupuesto por corrida**, que se cuenta desde que arranca la función y
 * se reparte entre las tres fases: cada una deja de empezar trabajo al llegar a
 * su límite.
 *
 * POR QUÉ 140 s. El corte sólo se mira entre una iteración y la siguiente, así que
 * lo que cuesta de más es la iteración que arrancó justo antes del límite, con cada
 * llamada a Google cortada a los 30 s (`CORTE_MS` de `calendar.ts` y
 * `CORTE_DEL_TOKEN_MS` de `google.ts`). Lo que cuesta cada fase, en el peor caso:
 *
 *  - **Pendientes** (la que fija el número): `crearEvento` hace el POST, recibe el
 *    409 —que **es** el caso normal de reintentar un alta que cortó a los 30 s—,
 *    hace su `leerEvento` interno, y después `restaurar` lee otra vez y manda el
 *    `PUT`: cuatro llamadas. **Y llega con el token frío**: una fila encolada por un
 *    alta fallida tiene `inicio_escrito` en null y queda fuera del `select` del
 *    barrido, así que la casilla típica de un pendiente es la que ninguna fase
 *    anterior tocó. Cinco llamadas, 150 s. 140 + 150 = 290 < 300. Con 170 serían
 *    320, y la fila `agenda / pendientes` no llegaría a escribirse: justo lo que el
 *    presupuesto existe para evitar.
 *  - **Canales**: el canje del token, `abrirCanal` y un solo `cerrarCanal` (el del
 *    viejo, o el del que se acaba de abrir si el upsert falló; nunca los dos): 90 s.
 *  - **Barrido**: el canje del token y una lectura de evento: 60 s.
 *
 * Con los límites de abajo, las tres fases terminan como tarde a los 170, 170 y 290 s.
 */
export const PRESUPUESTO_DE_LA_CORRIDA_MS = 140_000;

/**
 * **El piso de las fases 2 y 3 es de mejor esfuerzo, no una garantía.** Sin él el
 * reparto sería por prioridad absoluta: si los canales se comen todo, el barrido y
 * los pendientes cortan en la primera iteración corrida tras corrida, y la cola de
 * las personas no se reintenta nunca, que es justo el caso del día malo. Los canales
 * dejan de empezar casillas 60 s antes del fin y el barrido 30 s antes: en un día
 * en que Google contesta lento pero contesta, lo que queda alcanza.
 *
 * **Qué lo rompe:** cada reserva es menor que lo que puede desbordar una sola
 * iteración de la fase anterior. Una casilla de canales empezada justo en su límite
 * puede costar 90 s (token, `abrirCanal`, `cerrarCanal`) y la reserva que le sigue es
 * de 30; una lectura del barrido puede costar 60 (token y lectura) y su reserva es de
 * 30. Si Google cuelga, la fase que se pasa se come el piso de la siguiente, y esa
 * corta en la primera iteración. Se ve —las filas de `sincronizaciones` quedan en
 * `ok: false` y nombran lo que no se alcanzó—, pero no se evita.
 *
 * **Por qué una garantía de verdad no entra en 300 s.** Para asegurarle a los
 * pendientes que empiezan, el barrido tendría que cortar 60 s antes que ellos
 * (su peor iteración), y para asegurárselo al barrido, los canales 90 s antes que
 * él: 90 + 60 = 150 s de reserva antes del límite de los pendientes, que es de 140.
 * El límite de los canales tendría que ser **cero** (140 − 150 < 0), o sea que no
 * harían nada nunca. La única salida sería cortar *adentro* de una iteración, con
 * un `AbortSignal` común a todas las llamadas de la corrida, que es otro diseño y
 * no se hizo.
 */
export const RESERVA_PARA_BARRIDO_Y_PENDIENTES_MS = 60_000;
export const RESERVA_PARA_PENDIENTES_MS = 30_000;

/**
 * Los tres límites (instantes, en ms de época) de una corrida que arrancó en
 * `empezo`. El transcurrido ya está descontado: el reparto es por instante y no
 * por duración, así que si una fase termina antes, la siguiente aprovecha lo que
 * sobró.
 */
export function limitesDeLaCorrida(empezo: number): { canales: number; barrido: number; pendientes: number } {
  const fin = empezo + PRESUPUESTO_DE_LA_CORRIDA_MS;
  return {
    canales: fin - RESERVA_PARA_BARRIDO_Y_PENDIENTES_MS,
    barrido: fin - RESERVA_PARA_PENDIENTES_MS,
    pendientes: fin,
  };
}

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
 *
 * `limiteEnMsDeEpoca` es **un instante** (el `Date.now()` a partir del cual no se
 * empieza otra casilla) **y no una duración**: es el límite que reparte
 * `limitesDeLaCorrida`. Pasarle `240_000` a la vieja usanza daría un límite de
 * 1970 y cortaría siempre, en silencio. Lo que no se alcanza va nombrado en
 * `fallos`.
 */
export async function ponerAlDiaLosCanales(
  supabase: SupabaseClient,
  appUrl: string | undefined,
  ahora: Date = new Date(),
  limiteEnMsDeEpoca: number = Infinity
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
  for (let i = 0; i < hoy.length; i++) {
    const { casilla, motivo } = hoy[i];
    if (Date.now() >= limiteEnMsDeEpoca) {
      // Cada casilla son hasta 90 s en el peor caso (el canje del token, `abrirCanal` y
      // un solo `cerrarCanal`): sin este corte la fase puede matar la función antes de
      // que nada quede registrado. Ver `PRESUPUESTO_DE_LA_CORRIDA_MS`.
      r.fallos.push(
        `Se cortó por tiempo: quedaron sin abrir o renovar ${hoy.slice(i).map((c) => c.casilla).join(", ")}. ` +
          `Se reintenta mañana, y mientras tanto esas casillas no avisan.`
      );
      break;
    }
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
 * Cuántas divergencias se detectaron y qué pasó con cada una. **Existe para que
 * el peor fallo posible no sea silencioso.**
 *
 * Si la anotación condicional de `revisarLaCasilla` no tocara nunca la fila
 * (un detalle de formato de fecha en el `eq` sobre un `timestamptz`, por
 * ejemplo), ni el webhook ni el barrido registrarían ninguna divergencia, la
 * campana quedaría en cero y el sistema se vería **exactamente igual que si
 * funcionara**. Es el anti-objetivo del diseño cumplido por un detalle. Contar
 * lo que se detectó contra lo que se anotó es lo que lo hace visible.
 *
 * **`revisadas` es un escalón más arriba: los eventos que efectivamente se
 * compararon contra Google.** Si el `select` de `revisarLaCasilla` no devolviera
 * filas (el `.gte("fin", …)` sobre un `timestamptz`, los filtros de null), no
 * habría nada que detectar, `detectadas` sería 0, el resumen daría `null` y el
 * barrido se vería **idéntico a un día sano**. «14 casillas, 0 eventos mirados»
 * en cambio salta a la vista. Un 0 es legítimo mientras no haya eventos futuros
 * escritos en Google; con eventos en la Agenda, es que la consulta no los
 * encuentra.
 *
 * `detectadas = anotadas + porCarrera + sinExplicar + conError`. Un cero en
 * `anotadas` con `detectadas` mayor que cero **es sospechoso**, y lo que se mira
 * es `sinExplicar`:
 *
 *  - `porCarrera`: el `update` no tocó nada porque, al volver a leer la fila, ya
 *    no era la que se había leído (una escritura propia cambió `inicio_escrito` y
 *    `fin_escrito`, alguien la divergió, o se borró). Es lo que el predicado
 *    condicional existe para hacer, y no es un problema.
 *  - `sinExplicar`: el `update` no tocó nada **y la fila sigue exactamente como se
 *    leyó**. El predicado tendría que haber coincidido y no lo hizo: está roto.
 *    Mirar el `eq` sobre `inicio_escrito` / `fin_escrito` (¿el texto que devolvió
 *    PostgREST viaja igual en el filtro?) y que `is("divergencia", null)` siga
 *    siendo cierto.
 *  - `conError`: la base devolvió un error al anotar (también va a `fallos`).
 */
export interface ConteoDeLaRevision {
  /** Eventos comparados contra Google (la lectura salió bien). */
  revisadas: number;
  detectadas: number;
  anotadas: number;
  porCarrera: number;
  sinExplicar: number;
  conError: number;
}

export const conteoVacio = (): ConteoDeLaRevision => ({
  revisadas: 0, detectadas: 0, anotadas: 0, porCarrera: 0, sinExplicar: 0, conError: 0,
});

/**
 * La frase para el registro de `sincronizaciones` cuando lo detectado no es lo
 * anotado, o `null` si coinciden. Lleva los cuatro números y, si hay
 * `sinExplicar`, qué mirar: es lo que se lee el primer día.
 */
export function resumenDelConteo(c: ConteoDeLaRevision): string | null {
  if (c.detectadas === c.anotadas) return null;
  const partes = [`${c.detectadas} divergencias detectadas, ${c.anotadas} anotadas`];
  if (c.porCarrera > 0) {
    partes.push(`${c.porCarrera} no se anotaron porque la fila cambió mientras se miraba Google (carrera legítima)`);
  }
  if (c.conError > 0) partes.push(`${c.conError} no se anotaron por un error de la base`);
  if (c.sinExplicar > 0) {
    partes.push(
      `${c.sinExplicar} SIN EXPLICACIÓN: el update condicional no tocó una fila que no había cambiado, así que ` +
        `el predicado está roto y esa divergencia no quedó registrada. Mirar el eq sobre inicio_escrito y ` +
        `fin_escrito (timestamptz) en revisarLaCasilla`
    );
  }
  return partes.join(", ");
}

/**
 * Qué decir cuando un barrido no miró **ningún** evento, y si eso es un fallo.
 *
 * Un cero de `revisadas` es ambiguo: es legítimo mientras no haya eventos futuros
 * escritos en Google, y es el bug si el `select` de `revisarLaCasilla` no los
 * encuentra. Lo que los distingue es una cuenta **independiente de ese `select`**
 * (`contarEventosPorRevisar`): si hay filas que cumplen el criterio y no se miró
 * ninguna, no es un cero legítimo.
 *
 *  - `candidatas === 0`: es lo esperado. **No** es un fallo y en un día sano no
 *    suena nunca.
 *  - `candidatas > 0`: el `select` no las encuentra. **Es un fallo**: `roto`.
 *  - `candidatas === null`: no se pudo hacer la cuenta, y ante la duda se nota.
 *
 * El texto vive en la columna `error` y esa sólo se ve cuando la fila queda con
 * `ok: false`: por eso el caso malo tiene que ser `roto`.
 */
export function veredictoDeCeroEventos(
  casillas: number,
  candidatas: number | null
): { roto: boolean; texto: string } {
  if (candidatas === 0) {
    return {
      roto: false,
      texto: `${casillas} casillas, 0 eventos mirados, y es lo esperado: no hay ningún evento futuro escrito en Google que revisar`,
    };
  }
  if (candidatas === null) {
    return {
      roto: true,
      texto:
        `${casillas} casillas, 0 eventos mirados, y no se pudo comprobar si había eventos futuros que ` +
        `revisar: no se puede descartar que el select de revisarLaCasilla no los esté encontrando`,
    };
  }
  return {
    roto: true,
    texto:
      `${casillas} casillas, 0 eventos mirados, pero hay ${candidatas} eventos futuros escritos en Google que ` +
      `cumplen el criterio: el select de revisarLaCasilla no los está encontrando (mirar el filtro de fin sobre ` +
      `timestamptz y los de null). Hasta que se arregle ninguna divergencia se detecta`,
  };
}

/**
 * Cuántos eventos cumplen el criterio de `revisarLaCasilla` según **otra
 * consulta**: sin ningún filtro en la base, trayendo las filas y aplicando el
 * criterio acá, en JS. Es a propósito: contarlas con los mismos filtros del `select`
 * sospechoso daría el mismo cero. Sólo corre cuando el barrido no miró nada, así
 * que su costo no cuenta. `null` si no se pudo leer.
 */
async function contarEventosPorRevisar(
  supabase: SupabaseClient,
  casillas: string[],
  ahora: Date
): Promise<number | null> {
  try {
    const filas = await traerTodo<{
      casilla: string; google_event_id: string | null; inicio_escrito: string | null;
      divergencia: string | null; fin: string;
    }>((desde, hasta) =>
      supabase
        .from("agenda_eventos")
        .select("casilla, google_event_id, inicio_escrito, divergencia, fin")
        .order("id")
        .range(desde, hasta)
    );
    const delBarrido = new Set(casillas);
    return filas.filter(
      (f) =>
        delBarrido.has(comoCasilla(f.casilla)) &&
        Boolean(f.google_event_id) &&
        Boolean(f.inicio_escrito) &&
        !f.divergencia &&
        new Date(f.fin).getTime() >= ahora.getTime()
    ).length;
  } catch {
    return null;
  }
}

/**
 * El `update` condicional no tocó nada: ¿fue una carrera o es un predicado roto?
 * Se vuelve a leer la fila. Si ya no existe, o cambió su divergencia o lo
 * escrito, fue una carrera; si sigue idéntica a como se leyó, el predicado tendría
 * que haber coincidido. Si ni siquiera se puede releer, se cuenta como sin
 * explicación: ante la duda, que se note.
 */
async function porQueNoSeAnoto(
  supabase: SupabaseClient,
  f: FilaARevisar
): Promise<{ motivo: "carrera" } | { motivo: "sinExplicar"; detalle: string }> {
  const { data, error } = await supabase
    .from("agenda_eventos")
    .select("id, divergencia, inicio_escrito, fin_escrito")
    .eq("id", f.id)
    .maybeSingle();
  if (error) return { motivo: "sinExplicar", detalle: `ni siquiera se pudo volver a leer la fila (${error.message})` };
  if (!data) return { motivo: "carrera" };
  if (data.divergencia !== null || data.inicio_escrito !== f.inicio_escrito || data.fin_escrito !== f.fin_escrito) {
    return { motivo: "carrera" };
  }
  return {
    motivo: "sinExplicar",
    detalle: `la fila sigue igual que cuando se leyó (inicio_escrito ${f.inicio_escrito}, fin_escrito ${f.fin_escrito}) y el update igual no la tocó`,
  };
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
 *
 * **Cuenta lo que detectó contra lo que anotó** (`conteo`, que se acumula entre
 * llamadas) y quien llama lo registra con `resumenDelConteo`. **Un cero en
 * anotadas con divergencias detectadas es sospechoso**: cuando el `update`
 * condicional no toca nada se vuelve a leer la fila, y si no cambió, ese caso va a
 * `sinExplicar` **y también a `fallos`, nombrando la casilla y el evento**: el
 * predicado está roto. Ver `ConteoDeLaRevision` para qué mirar.
 *
 * `limiteEnMsDeEpoca` es un instante (`Date.now()` a partir del cual no se empieza
 * otro evento), **no una duración**: una duración daría un límite de 1970 y
 * cortaría siempre, en silencio. Corta la revisión entre evento y evento: lo que
 * queda sin mirar va nombrado en `fallos`, con la casilla y cuántos eran. Cada
 * lectura a Google puede tardar hasta 30 s, así que quien lo pasa tiene que dejar
 * margen.
 */
export async function revisarLaCasilla(
  supabase: SupabaseClient,
  casilla: string,
  fallos: string[] = [],
  ahora: Date = new Date(),
  conteo: ConteoDeLaRevision = conteoVacio(),
  limiteEnMsDeEpoca: number = Infinity
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

  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    if (Date.now() >= limiteEnMsDeEpoca) {
      fallos.push(
        `${casilla}: se cortó por tiempo y quedaron ${filas.length - i} eventos sin revisar. ` +
          `Se vuelven a ver con el próximo aviso de Google o con el barrido de mañana.`
      );
      break;
    }
    let enGoogle;
    try {
      enGoogle = await leerEvento(casilla, f.google_event_id);
    } catch (e) {
      fallos.push(`${casilla}: no se pudo leer de Google el evento ${f.id}: ${textoDe(e)}`);
      continue;
    }

    conteo.revisadas++;
    const divergencia = queDivergio({ inicio: f.inicio_escrito, fin: f.fin_escrito }, enGoogle);
    if (!divergencia) continue;
    conteo.detectadas++;

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
      conteo.conError++;
      fallos.push(
        `${casilla}: el evento ${f.id} ${divergencia === "borrado" ? "lo borraron" : "lo movieron"} en Google ` +
          `pero no se pudo anotar, ni en dos intentos (${error}). Se vuelve a ver con el próximo aviso de Google.`
      );
      continue;
    }
    if (anotadas.length === 0) {
      const por = await porQueNoSeAnoto(supabase, f);
      if (por.motivo === "carrera") {
        conteo.porCarrera++;
      } else {
        conteo.sinExplicar++;
        fallos.push(
          `${casilla}: el evento ${f.id} ${divergencia === "borrado" ? "lo borraron" : "lo movieron"} en Google ` +
            `y NO quedó anotado, sin explicación: ${por.detalle}. El predicado del update condicional está ` +
            `roto: hasta que se arregle ninguna divergencia se registra.`
        );
      }
      continue;
    }

    conteo.anotadas++;
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
  /** Detectadas contra anotadas, de todas las casillas juntas: ver `ConteoDeLaRevision`. */
  conteo: ConteoDeLaRevision;
  /**
   * Sólo si no se miró ningún evento y nada más había fallado: qué dice y si es un
   * fallo (`veredictoDeCeroEventos`). `null` cuando se miró alguno.
   */
  ceroEventos: { roto: boolean; texto: string } | null;
}

/**
 * Revisa **todas** las casillas activas contra Google, como si cada una hubiera
 * avisado: es la red que cubre lo que un canal no vio (ver el encabezado). Escribe
 * la divergencia exactamente igual que el webhook, porque usa la misma
 * `revisarLaCasilla`, así que **no hace falta nada de la Tarea 10 para que
 * quede**: la campana la levanta de la fila.
 *
 * **Nunca tira por una casilla**: cada una va por su cuenta y lo que falle vuelve
 * en `fallos` nombrándola. Con `limiteEnMsDeEpoca` (un instante y no una
 * duración; **el de `limitesDeLaCorrida`** y no uno propio del barrido) corta antes de que Vercel mate la
 * función, y **lo dice**: las casillas que no se alcanzaron a mirar van nombradas.
 * El orden es el de `usuarios`, así que si se cortara seguido se miraría siempre
 * a las mismas primero y habría que rotarlas. Tira sólo si no puede leer
 * `usuarios`.
 */
export async function barrerLasCasillas(
  supabase: SupabaseClient,
  ahora: Date = new Date(),
  limiteEnMsDeEpoca: number = Infinity
): Promise<DelBarrido> {
  const casillas = [...new Set((await casillasActivas(supabase)).map(comoCasilla))];
  const r: DelBarrido = { casillas: 0, divergencias: [], fallos: [], conteo: conteoVacio(), ceroEventos: null };

  for (let i = 0; i < casillas.length; i++) {
    const casilla = casillas[i];
    if (Date.now() >= limiteEnMsDeEpoca) {
      r.fallos.push(`Se cortó el barrido por tiempo: no se miraron ${casillas.slice(i).join(", ")}.`);
      break;
    }
    r.casillas++;
    try {
      for (const d of await revisarLaCasilla(supabase, casilla, r.fallos, ahora, r.conteo, limiteEnMsDeEpoca)) {
        r.divergencias.push({ casilla, ...d });
      }
    } catch (e) {
      r.fallos.push(`${casilla}: no se pudo revisar en el barrido: ${textoDe(e)}`);
    }
  }

  // Un cero sin ningún otro fallo es el único que hay que interpretar: con fallos
  // (una lectura que falló, un corte por tiempo) la corrida ya queda en rojo.
  if (r.casillas > 0 && r.conteo.revisadas === 0 && r.fallos.length === 0) {
    r.ceroEventos = veredictoDeCeroEventos(r.casillas, await contarEventosPorRevisar(supabase, casillas, ahora));
  }
  return r;
}
