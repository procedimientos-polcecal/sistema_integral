import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarPush, type Aviso } from "@/lib/core/webpush";
import { esHoraDeAvisar, type ResultadoDelAviso } from "@/lib/core/avisoAlInstante";
import { traerTodo } from "@/lib/core/paginado";
import type { Divergencia } from "./divergencia";

/**
 * El aviso en el momento de que algo de la Agenda cambió en Google: un push al
 * dueño del evento y a sus invitados que son usuarios del SdG.
 *
 * ── POR QUÉ ESTO NO PASA POR `avisarAQuienDecide()` ──────────────────────────
 *
 * El portón de `lib/core/avisoAlInstante.ts` pide tres condiciones para
 * interrumpir. Esto cumple dos:
 *
 *   1. Hay una **persona nombrada**: el dueño y los invitados del evento.
 *   3. **Acaba de pasar**: el webhook de Google entrega la divergencia en el
 *      momento en que alguien toca el evento.
 *
 * Y **no cumple la 2**: no es cierto que nada avance hasta que alguien
 * decida. El evento sigue donde Google lo dejó y la Agenda no se frena —la OT
 * se hace igual, la sincronización simplemente deja de pisarlo—; lo que se
 * pierde es que el calendario y la OT dicen cosas distintas, y eso es de
 * «miralo hoy», que es el trabajo del resumen diario.
 *
 * **Se manda igual porque se pidió instantánea**, y ésa es una excepción que
 * quedó escrita acá, al lado del código, para que nadie la lea como permiso: el
 * próximo aviso que cumpla sólo dos de las tres sigue sin merecer interrumpir.
 * Por eso vive en `lib/agenda/` y no se le agrega un caso a `avisoAlInstante.ts`:
 * que ese archivo siga diciendo «hoy las cumplen dos cosas» tiene que seguir
 * siendo verdad.
 *
 * Las demás reglas de ese archivo **sí** se respetan, y son las que
 * evitan que alguien apague las notificaciones:
 *
 *  - **Una por corrida y por persona, no una por evento.** Si alguien borra diez
 *    eventos de una vez en Google, `revisarLaCasilla` devuelve diez divergencias
 *    juntas y cada persona recibe un push que dice «10 eventos…», no diez.
 *  - **Ventana 7:00–21:00 de Argentina** (`esHoraDeAvisar`, la misma función:
 *    una sola definición de la franja). Fuera de ella **no se manda y no se
 *    encola**.
 *  - **Payload plano, `{title, body, url}`**, con la `url` en el primer nivel:
 *    es el `Aviso` de `lib/core/webpush.ts`. Un nivel de más costó un mes de
 *    notificaciones que no llevaban a ningún lado.
 *
 * ── LO QUE NO LLEGA POR ACÁ ──────────────────────────────────────────────────
 *
 * Sólo lo engancha el **webhook** (`app/api/agenda/google`). El barrido diario
 * corre a las 5 UTC, o sea las 2 de la mañana de Argentina, **siempre fuera de
 * la ventana**: engancharlo sería una llamada que nunca manda. Lo que el barrido
 * encuentra está en la campana desde que se anota, y llega al resumen del lunes.
 *
 * Tampoco se encola lo que cae fuera de hora: no hay tabla de pendientes. Una
 * divergencia que se detecta a las 23:00 está en la campana a la mañana, y es lo
 * único que la repesca los días que no son lunes (ver `ES_POR_PERSONA` en
 * `lib/home/avisos.ts` y por qué el resumen diario de movimiento no la lleva).
 *
 * **Nunca tira.** Lo llama el webhook, que ya anotó la divergencia cuando llega
 * acá, y que Google reintenta si recibe un 500: un push service caído no puede
 * convertirse en un aviso de Google que se repite. Todo va adentro de un `try`
 * que devuelve el motivo.
 */

/** Cuántos eventos se nombran antes de resumir el resto. Igual que los demás resúmenes. */
const CUANTOS_SE_NOMBRAN = 3;

/** Hasta dónde entra el título de un evento antes de recortarse. */
const LARGO_DEL_TITULO = 60;

/** A dónde lleva la notificación: la Agenda, que es donde se da por vista. */
export const URL_DEL_AVISO = "/agenda";

/** Un evento recién divergido, con lo que hace falta para nombrarlo. */
export interface EventoQueDivergio {
  titulo: string;
  divergencia: Divergencia;
}

const recortar = (t: string) => {
  const limpio = t.trim();
  if (!limpio) return "(sin título)";
  return limpio.length > LARGO_DEL_TITULO ? `${limpio.slice(0, LARGO_DEL_TITULO)}…` : limpio;
};

/**
 * Los eventos de una persona convertidos en **una** notificación. `null` si no
 * hay ninguno: no se manda un push para decir que no pasa nada.
 *
 * Con uno solo se dice qué le pasó —lo borraron o lo movieron— y cómo se llama,
 * que es lo que deja decidir si hay que entrar. Con varios lo útil es cuántos
 * son y los primeros nombres.
 */
export function textoDeLaDivergencia(eventos: EventoQueDivergio[]): Aviso | null {
  if (eventos.length === 0) return null;

  if (eventos.length === 1) {
    const [e] = eventos;
    return {
      title:
        e.divergencia === "borrado"
          ? "Borraron en Google un evento de la Agenda"
          : "Movieron en Google un evento de la Agenda",
      body: recortar(e.titulo),
      url: URL_DEL_AVISO,
    };
  }

  const nombrados = eventos.slice(0, CUANTOS_SE_NOMBRAN).map((e) => recortar(e.titulo));
  const restantes = eventos.length - nombrados.length;
  const cuerpo =
    restantes > 0
      ? `${nombrados.join(", ")} y ${restantes} más`
      : `${nombrados.slice(0, -1).join(", ")} y ${nombrados[nombrados.length - 1]}`;

  return {
    title: `${eventos.length} eventos de la Agenda cambiaron en Google`,
    body: cuerpo,
    url: URL_DEL_AVISO,
  };
}

/** Un evento leído de la base con su dueño y sus invitados. */
export interface EventoConGente {
  id: string;
  titulo: string;
  dueno_id: string;
  agenda_invitados: { usuario_id: string | null }[] | null;
}

/**
 * Qué eventos le tocan a cada persona: **el dueño y los invitados que son
 * usuarios del SdG**. Un invitado externo no tiene `usuario_id` y no está en el
 * resultado: no tiene cómo recibir un push de acá.
 *
 * Cada persona ve sólo **sus** eventos: si de diez que se borraron uno es de
 * Beto, a Beto le llega uno y a Ana los nueve que le tocan. El resumen no
 * nombra eventos ajenos.
 */
export function eventosPorPersona(
  eventos: EventoConGente[],
  divergencias: { evento_id: string; divergencia: Divergencia }[]
): Map<string, EventoQueDivergio[]> {
  const queDijo = new Map(divergencias.map((d) => [d.evento_id, d.divergencia]));
  const porPersona = new Map<string, EventoQueDivergio[]>();

  for (const e of eventos) {
    const divergencia = queDijo.get(e.id);
    if (!divergencia) continue;
    const gente = new Set<string>([e.dueno_id]);
    for (const i of e.agenda_invitados ?? []) if (i.usuario_id) gente.add(i.usuario_id);
    for (const usuarioId of gente) {
      porPersona.set(usuarioId, [...(porPersona.get(usuarioId) ?? []), { titulo: e.titulo, divergencia }]);
    }
  }
  return porPersona;
}

/**
 * Avisa de las divergencias que **esta corrida** acaba de anotar: una
 * notificación por persona, a todos sus aparatos.
 *
 * El orden de las comprobaciones es el que no cuesta nada cuando no hay nada
 * que hacer —el caso de casi todos los avisos de Google, que son ecos—: primero
 * las divergencias, después la hora, y recién ahí se toca la base.
 */
export async function avisarDeLasDivergencias(
  admin: SupabaseClient,
  divergencias: { evento_id: string; divergencia: Divergencia }[],
  /** Sólo para los tests. En producción se llama sin nada. */
  ahora?: Date
): Promise<ResultadoDelAviso & { error?: string }> {
  if (divergencias.length === 0) return { enviadas: 0, personas: 0, motivo: "nada que avisar" };
  if (!esHoraDeAvisar(ahora)) return { enviadas: 0, personas: 0, motivo: "fuera de hora" };

  try {
    // De a lotes: un `.in()` con muchos ids arma una URL que PostgREST rechaza.
    const ids = divergencias.map((d) => d.evento_id);
    const eventos: EventoConGente[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await admin
        .from("agenda_eventos")
        .select("id, titulo, dueno_id, agenda_invitados(usuario_id)")
        .in("id", ids.slice(i, i + 200))
        .returns<EventoConGente[]>();
      if (error) throw new Error(error.message);
      eventos.push(...(data ?? []));
    }

    const porPersona = eventosPorPersona(eventos, divergencias);
    if (porPersona.size === 0) return { enviadas: 0, personas: 0, motivo: "sin destinatarios" };

    // Una cuenta dada de baja no recibe: desactivar a alguien no le limpia las
    // suscripciones. Mismo cuidado que el aviso hermano.
    const { data: activos, error: errorUsuarios } = await admin
      .from("usuarios")
      .select("id")
      .eq("activo", true)
      .in("id", [...porPersona.keys()]);
    if (errorUsuarios) throw new Error(errorUsuarios.message);
    const estaActivo = new Set((activos ?? []).map((u) => u.id as string));

    const suscripciones = await traerTodo<{
      usuario_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
    }>((desde, hasta) =>
      admin.from("push_suscripciones").select("usuario_id, endpoint, p256dh, auth").range(desde, hasta)
    );

    let enviadas = 0;
    const alcanzados = new Set<string>();
    for (const aparato of suscripciones) {
      if (!estaActivo.has(aparato.usuario_id)) continue;
      const suyos = porPersona.get(aparato.usuario_id);
      if (!suyos) continue;
      const aviso = textoDeLaDivergencia(suyos);
      if (!aviso) continue;

      const resultado = await enviarPush(aparato, aviso);
      if (resultado === "enviada") {
        enviadas++;
        alcanzados.add(aparato.usuario_id);
      } else if (resultado === "vencida") {
        // Ese aparato ya no existe: se borra esa fila y no las otras de la misma persona.
        await admin
          .from("push_suscripciones")
          .delete()
          .eq("usuario_id", aparato.usuario_id)
          .eq("endpoint", aparato.endpoint);
      }
    }

    return { enviadas, personas: alcanzados.size };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    console.error("agenda: no se pudo avisar de las divergencias:", motivo);
    // `error` aparte de `motivo`: «fuera de hora» es una decisión y esto es un fallo,
    // y quien llama tiene que poder distinguirlos sin comparar frases.
    return { enviadas: 0, personas: 0, motivo, error: motivo };
  }
}
