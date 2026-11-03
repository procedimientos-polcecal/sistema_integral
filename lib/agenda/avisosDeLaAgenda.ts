import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { divergenciaVista } from "./pedido";

/**
 * Los dos conteos que la Agenda le da a la campana y al resumen diario.
 *
 * Son de naturaleza distinta y por eso no comparten nada más que el archivo:
 *
 *  - `contarDivergenciasSinVer` es **de una persona**: cuenta lo suyo.
 *  - `contarPasosCaidos` es **del sistema**: dice si la Agenda sigue mirando
 *    Google, y es lo mismo para todos.
 */

// ── Divergencias sin ver (de quien mira) ────────────────────────────────────

/** Un evento divergido con lo que hace falta para saber de quién es y si ya se vio. */
export interface EventoDivergido {
  id: string;
  dueno_id: string;
  divergencia_el: string | null;
  agenda_invitados: { usuario_id: string | null }[] | null;
  agenda_divergencias_vistas: { usuario_id: string; divergencia_el: string }[] | null;
}

/**
 * Cuántos de estos eventos divergidos son de `usuarioId` y todavía no los dio
 * por vistos.
 *
 * **«Suyo» es dueño o invitado que es usuario del SdG** —la misma definición que
 * `agenda_veo_evento()` en la base—, y **se filtra acá, explícito, y no se deja
 * al RLS.** Es lo que hace que la campana (cliente con sesión, RLS puesto) y el
 * resumen diario (cliente admin, que saltea RLS y recorre a todos) cuenten lo
 * mismo. Sin el filtro, el cron le contaría a cada persona las divergencias de
 * todas las demás: es la primera tabla de este sistema que filtra por fila y no
 * por acceso al módulo.
 *
 * Lo mismo con las vistas: cada uno da por vistas las suyas, así que se miran
 * sólo las de `usuarioId`. Y «vista» es `divergenciaVista`: se compara el
 * instante de `divergencia_el`, de modo que un evento que vuelve a divergir
 * reaparece solo.
 */
export function divergenciasSinVer(filas: EventoDivergido[], usuarioId: string): number {
  let cuantas = 0;
  for (const f of filas) {
    if (!f.divergencia_el) continue;
    const esSuyo =
      f.dueno_id === usuarioId || (f.agenda_invitados ?? []).some((i) => i.usuario_id === usuarioId);
    if (!esSuyo) continue;
    const mias = (f.agenda_divergencias_vistas ?? []).filter((v) => v.usuario_id === usuarioId);
    if (!divergenciaVista(f.divergencia_el, mias)) cuantas++;
  }
  return cuantas;
}

/**
 * Lo que `divergenciasSinVer` cuenta, leído de la base.
 *
 * Trae **todos** los eventos con divergencia y no los de la persona: son pocos
 * por naturaleza (una divergencia es una excepción y se limpia al destrabarla) y
 * un `or` entre «soy el dueño» y «soy invitado» sobre un embed no se puede
 * escribir en PostgREST sin traer el embed completo igual. `traerTodo` por si
 * algún día no son pocos.
 *
 * Si la lectura falla devuelve 0 y lo dice en el log: la campana corre en cada
 * página del sistema y no puede caerse por esto, y mientras la migración de la
 * Agenda no esté aplicada la tabla no existe. Es el mismo modo de fallar de los
 * demás conteos.
 */
export async function contarDivergenciasSinVer(
  supabase: SupabaseClient,
  usuarioId: string
): Promise<number> {
  try {
    const filas = await traerTodo<EventoDivergido>((desde, hasta) =>
      supabase
        .from("agenda_eventos")
        .select(
          "id, dueno_id, divergencia_el, agenda_invitados(usuario_id), agenda_divergencias_vistas(usuario_id, divergencia_el)"
        )
        .not("divergencia", "is", null)
        .order("id")
        .range(desde, hasta)
        .returns<EventoDivergido[]>()
    );
    return divergenciasSinVer(filas, usuarioId);
  } catch (e) {
    console.error("agenda: no se pudieron contar las divergencias sin ver:", e instanceof Error ? e.message : e);
    return 0;
  }
}

// ── Pasos de la Agenda con Google que se cayeron (del sistema) ──────────────

/**
 * Los pasos del cron de la Agenda que hablan con Google y de los que depende
 * que la Agenda se entere de algo. **Son éstos y no otros, a propósito:**
 *
 *  - `canales`: abrir y renovar los canales. Uno vencido y sin renovar es una
 *    casilla que deja de avisar, y nada lo dice.
 *  - `barrido`: mirar todas las casillas contra Google. Es la red de lo que un
 *    canal no vio.
 *
 * `pendientes` no entra: es reescribir lo que no se pudo escribir, y eso ya se
 * ve en el evento. Y `aviso_de_google` **tampoco, y es lo que más fácil se
 * agregaría por error**: esa fila se escribe **sólo cuando hay algo que
 * decir** (un fallo, o una carrera). Una corrida sana no escribe nada, así que
 * si la última fue un fallo, la fila queda en rojo **hasta el próximo fallo**
 * —días, semanas— aunque todo ande: el aviso quedaría clavado en una alarma
 * falsa que nadie puede apagar.
 */
export const PASOS_CON_GOOGLE = ["canales", "barrido"] as const;

/**
 * Cuánto puede pasar sin que un paso corra antes de darlo por caído. El cron es
 * diario (5 UTC): 36 horas es un día más medio de margen para una corrida
 * atrasada, y deja pasar un día perdido sin sonar. Dos días seguidos sin correr
 * no son un parpadeo.
 */
export const HORAS_SIN_CORRER = 36;

/** Lo que `ultima_sincronizacion` dice de una corrida. */
export interface CorridaDeLaAgenda {
  recurso: string;
  ok: boolean;
  created_at: string;
}

/**
 * Qué pasos están caídos. **Tres cosas lo son**, y la tercera es la que
 * justifica que esto exista:
 *
 *  1. La última corrida **falló** (`ok = false`): el cron ya lo anotó, con la
 *     casilla y lo que dijo Google.
 *  2. La última corrida es **vieja**: el cron no corrió. **No deja ninguna fila
 *     de fallo** —si no corre, no escribe—, así que mirar sólo `ok` lo vería
 *     verde para siempre. Es el canal muerto que no se distingue de uno sano,
 *     pero un nivel más arriba: el cron mismo.
 *  3. **Nunca corrió**: no hay fila. Suena el primer día —hasta que corra el
 *     cron— y es correcto: una Agenda que nunca miró Google no está sana. Si
 *     sonara por una Agenda que se despliega sin las credenciales de Google, es
 *     lo que tiene que hacer.
 *
 * **Qué cuenta:** la cantidad de pasos caídos, de 0 a 2. No es un conteo de cosas
 * —no cuenta casillas, porque la fila sólo trae el texto del error— y por eso su
 * número sólo sirve para que el movimiento diario avise cuando pasa de 0 a algo.
 * Está escrito así en `avisos.ts` y el título lo dice como «pasos», no como
 * «eventos» ni «canales».
 */
export function pasosCaidos(
  corridas: CorridaDeLaAgenda[],
  ahora: Date = new Date()
): (typeof PASOS_CON_GOOGLE)[number][] {
  const corte = ahora.getTime() - HORAS_SIN_CORRER * 3_600_000;
  return PASOS_CON_GOOGLE.filter((paso) => {
    const ultima = corridas.find((c) => c.recurso === paso);
    if (!ultima) return true;
    if (!ultima.ok) return true;
    const cuando = new Date(ultima.created_at).getTime();
    // Una fecha ilegible no puede contar como «corrió hace un rato».
    return Number.isNaN(cuando) || cuando < corte;
  });
}

/** Lo que se pudo saber de la salud de la Agenda. */
export interface SaludDeLaAgenda {
  /** Pasos caídos, de 0 a 2. Es 0 también cuando no se pudo mirar: ver `sinComprobar`. */
  caidos: number;
  /**
   * **La comprobación misma falló.** No es «todo bien» ni es «algo cayó»: es que
   * no se sabe. Es un estado aparte, con su propio aviso, y no un 0.
   */
  sinComprobar: boolean;
}

/**
 * Los pasos caídos, leídos de `ultima_sincronizacion`. Esa vista la leen todos
 * los autenticados, así que da lo mismo con la sesión que con el cliente admin.
 *
 * **Si la lectura falla NO devuelve 0**: devuelve `sinComprobar`. Es el único
 * aviso del sistema cuyo trabajo es detectar que algo dejó de funcionar en
 * silencio, y uno que dice «todo bien» cuando no pudo mirar cierra el fallo un
 * piso más abajo y lo abre un piso más arriba. Tampoco tira —ni por un error de
 * PostgREST ni por una excepción de red—: la campana corre en cada página y no
 * puede caerse por esto. Va al log y sale como su propio aviso
 * (`agenda-salud-sin-comprobar`), con un texto que dice que **la comprobación**
 * falló y no que los canales lo hayan hecho.
 */
export async function leerLaSaludDeLaAgenda(
  supabase: SupabaseClient,
  ahora: Date = new Date()
): Promise<SaludDeLaAgenda> {
  try {
    const { data, error } = await supabase
      .from("ultima_sincronizacion")
      .select("recurso, ok, created_at")
      .eq("modulo", "agenda")
      .in("recurso", [...PASOS_CON_GOOGLE])
      .returns<CorridaDeLaAgenda[]>();
    if (error) throw new Error(error.message);
    return { caidos: pasosCaidos(data ?? [], ahora).length, sinComprobar: false };
  } catch (e) {
    console.error("agenda: no se pudo comprobar la salud de la Agenda:", e instanceof Error ? e.message : e);
    return { caidos: 0, sinComprobar: true };
  }
}
