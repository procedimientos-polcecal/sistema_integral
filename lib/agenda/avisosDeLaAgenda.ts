import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import {
  estadoDeRecurso,
  haceCuantoCorto,
  type EstadoDeRecurso,
} from "@/lib/core/saludDeLasSincronizaciones";
import { divergenciaVista } from "./pedido";

/**
 * Lo que la Agenda le da a la campana, y el detalle de salud que muestra
 * `/agenda`. Son de naturaleza distinta y no comparten nada más que el archivo:
 *
 *  - `contarDivergenciasSinVer` es **de una persona**: cuenta lo suyo, y es lo
 *    único de acá que llega a la campana.
 *  - `lineasDeSalud` es **del sistema**: dice si la Agenda sigue mirando
 *    Google, es lo mismo para todos y hoy **no genera ningún aviso**.
 *
 * ── LOS DOS AVISOS DE SALUD DE LA AGENDA SE RETIRARON (05/11/2026) ───────────
 *
 * `agenda-pasos-caidos` y `agenda-salud-sin-comprobar` ya no existen: los
 * reemplaza `avisosDeSalud` de `lib/home/avisos.ts`, que hace lo mismo para los
 * 29 recursos de `ultima_sincronizacion` —`canales` y `barrido` entre ellos— con
 * la tolerancia declarada en el `REGISTRO` de
 * [lib/core/saludDeLasSincronizaciones.ts](../core/saludDeLasSincronizaciones.ts).
 * Dos avisos de salud con umbrales distintos diciendo cosas parecidas es
 * exactamente lo que la campana evita al salir de una sola función.
 *
 * Lo que **no** se retiró es `lineasDeSalud`: sigue siendo el detalle de la
 * Agenda en `/agenda`, y las dos exclusiones razonadas de `PASOS_CON_GOOGLE`
 * —`pendientes` y `aviso_de_google`— se conservan tal cual, ahora también en el
 * registro general como excepciones declaradas. Generalizar no es un permiso
 * para deshacerlas.
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

// ── La salud de los pasos con Google (del sistema) ──────────────────────────

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
 * diario, a las 05:00 UTC, y la cuenta está hecha sobre eso:
 *
 *  - Con **36 h** una sola corrida salteada ya sonaba, a las 17:00 UTC del día
 *    siguiente, doce horas antes de que le tocara correr de nuevo. Eso no es
 *    «un día perdido sin sonar»: es sonar por un día perdido.
 *  - Con **50 h** una corrida salteada **no suena**, y la segunda seguida sí: si
 *    la última fue a las 05:00 del día D, el umbral se cruza a las 07:00 UTC de
 *    D+2, dos horas después de la corrida que debió repararlo. Los dos días de
 *    margen tienen la hora de sobra para que una corrida lenta termine y se
 *    registre antes de que alguien mire.
 *
 * Está fijado con el cron real en el test (`lineasDeSalud`), no con una cifra
 * redonda: si el horario del cron en `vercel.json` cambia, esto se revisa. Es
 * el mismo número con el que los dos pasos entraron al `REGISTRO` general.
 */
export const HORAS_SIN_CORRER = 50;

/** Lo que `ultima_sincronizacion` dice de una corrida. */
export interface CorridaDeLaAgenda {
  recurso: string;
  ok: boolean;
  created_at: string;
  /** Lo que dijo el cron al fallar, sin traducir. Sólo lo lee la pantalla. */
  error?: string | null;
}

/** Cómo está un paso. `sana` es la única que no es un problema. */
export type EstadoDelPaso = EstadoDeRecurso;

/**
 * Cómo está un paso: la regla general del sistema, con la tolerancia de la
 * Agenda.
 *
 * **Las tres cosas que dejan caído a un paso** —falló, no corrió en
 * `HORAS_SIN_CORRER`, nunca corrió— y el porqué de cada una están en
 * `estadoDeRecurso`, que nació de esta misma función. Acá queda sólo lo que es
 * de la Agenda: cuántas horas de silencio tolera. No se deja una segunda copia
 * de la decisión porque de dos copias la que nadie toca es la que termina
 * mintiendo.
 */
export function estadoDelPaso(corrida: CorridaDeLaAgenda | undefined, ahora: Date): EstadoDelPaso {
  return estadoDeRecurso(corrida, HORAS_SIN_CORRER, ahora);
}

// ── La línea de estado que ve admin_sistema en /agenda ──────────────────────

const ETIQUETA_DEL_PASO: Record<(typeof PASOS_CON_GOOGLE)[number], string> = {
  canales: "Canales de Google",
  barrido: "Barrido de las casillas",
};

export interface LineaDeSalud {
  paso: (typeof PASOS_CON_GOOGLE)[number];
  etiqueta: string;
  estado: EstadoDelPaso;
  /** La frase completa: cuándo corrió por última vez y qué pasó. */
  texto: string;
}

/**
 * Una línea por paso: cuándo corrió por última vez y cuál está caído. Es lo que
 * muestra `/agenda` a `admin_sistema`.
 *
 * Nació porque los dos avisos de salud de la Agenda llevaban ahí —un push que
 * aterriza en una pantalla donde no hay rastro del problema es el bug de las
 * notificaciones que no llevaban a ningún lado—. Esos avisos se retiraron y
 * ahora el aviso de `canales` o `barrido` lleva a `/administracion/salud`, pero
 * esto se queda: es el detalle de la Agenda, en la pantalla de la Agenda, para
 * quien está ahí y no viene de ningún aviso.
 */
export function lineasDeSalud(corridas: CorridaDeLaAgenda[], ahora: Date = new Date()): LineaDeSalud[] {
  return PASOS_CON_GOOGLE.map((paso) => {
    const corrida = corridas.find((c) => c.recurso === paso);
    const estado = estadoDelPaso(corrida, ahora);
    const cuando = corrida ? haceCuantoCorto(corrida.created_at, ahora) : "";
    const texto =
      estado === "nunca"
        ? "Nunca corrió."
        : estado === "fallo"
          ? `Falló la última corrida (${cuando}): ${corrida?.error?.trim() || "sin detalle"}`
          : estado === "vieja"
            ? `No corre desde ${cuando} (más de ${HORAS_SIN_CORRER} h sin correr; el cron es diario).`
            : `Corrió ${cuando}, sin fallos.`;
    return { paso, etiqueta: ETIQUETA_DEL_PASO[paso], estado, texto };
  });
}

/** Lo que se pudo saber de la salud de la Agenda. */
export interface SaludDeLaAgenda {
  /**
   * **La comprobación misma falló.** No es «todo bien» ni es «algo cayó»: es que
   * no se sabe. Es un estado aparte y no una lista vacía de corridas.
   */
  sinComprobar: boolean;
  /** Lo leído, para dibujar la línea de estado de `/agenda`. Vacío si no se pudo leer. */
  corridas: CorridaDeLaAgenda[];
}

/**
 * Las corridas de los dos pasos, leídas de `ultima_sincronizacion`. Esa vista la
 * leen todos los autenticados, así que da lo mismo con la sesión que con el
 * cliente admin.
 *
 * **Si la lectura falla NO devuelve una lectura sana**: devuelve `sinComprobar`,
 * y la pantalla dice que no se pudo mirar en vez de pintar los dos pasos en
 * «nunca corrió». Decir «todo bien» cuando no se pudo mirar cierra el fallo un
 * piso más abajo y lo abre un piso más arriba. Tampoco tira —ni por un error de
 * PostgREST ni por una excepción de red—: esto corre al dibujar `/agenda` y no
 * puede tumbar la pantalla. El motivo va al log.
 *
 * **Un `data` nulo sin error también es `sinComprobar`**, y no una vista vacía:
 * de una lectura que no dijo nada no se afirma nada. Es la misma regla de
 * `leerLaSalud` en `lib/core/saludDeLasSincronizaciones.ts`.
 */
export async function leerLaSaludDeLaAgenda(
  supabase: SupabaseClient
): Promise<SaludDeLaAgenda> {
  try {
    const { data, error } = await supabase
      .from("ultima_sincronizacion")
      .select("recurso, ok, error, created_at")
      .eq("modulo", "agenda")
      .in("recurso", [...PASOS_CON_GOOGLE])
      .returns<CorridaDeLaAgenda[]>();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("la vista no devolvió datos ni error");
    return { sinComprobar: false, corridas: data };
  } catch (e) {
    console.error("agenda: no se pudo comprobar la salud de la Agenda:", e instanceof Error ? e.message : e);
    return { sinComprobar: true, corridas: [] };
  }
}
