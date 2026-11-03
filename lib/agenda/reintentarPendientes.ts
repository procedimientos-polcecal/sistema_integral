import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import type { EventoParaGoogle } from "@/lib/core/calendar";
import { anotarEnLaFila } from "./cargar";
import { escribirEnGoogle, columnasDespuesDeEscribir } from "./escribirEnGoogle";
import { eventoParaGoogle } from "./pedido";

/**
 * La cola de escrituras a Google que fallaron (`google_pendiente`) y su
 * reintento diario.
 *
 * Es la otra mitad de la decisión «un fallo automático va a una cola con
 * reintento»: sin esto la cola se llena y no la vacía nadie, y un evento que
 * nunca llegó a Google es un evento que para sus invitados no existe.
 *
 * ── EL EVENTO DIVERGIDO NO SE REINTENTA ─────────────────────────────────────
 *
 * Un evento con `divergencia` **puede** tener `google_pendiente`: el PATCH de la
 * Agenda anota un pendiente cuando falla el guardado de los invitados, y lo hace
 * antes de llegar a la rama de divergencia. Reintentarlo escribiría en Google lo
 * que dice el SdG encima de lo que una persona hizo del otro lado, que es
 * exactamente lo que todo este diseño decidió no hacer. Con `divergencia` puesta
 * el pendiente se **salta**, y lo resuelve `destrabar`, que además lo limpia.
 * `quePendientesReintentar` es esa decisión, aparte para poder probarla.
 *
 * ── LO QUE NO ESTÁ ACÁ ──────────────────────────────────────────────────────
 *
 * Un borrado de espejo que Google rechazó **no** está en `google_pendiente`: se
 * anota en `aviso` (ver `borrarLosEventosDeLasOT`), justamente para que este
 * reintento no lo levante y resucite un evento que se quería borrar. Acá no se
 * toca `aviso`.
 */

export interface PendienteLeido {
  id: string;
  titulo: string;
  descripcion: string | null;
  lugar: string | null;
  inicio: string;
  fin: string;
  casilla: string;
  google_event_id: string | null;
  divergencia: string | null;
}

/**
 * Cuáles se reintentan y cuáles se saltan, con el porqué. **Mira `divergencia`
 * antes que nada**: ver el encabezado.
 */
export function quePendientesReintentar<T extends { id: string; divergencia: string | null }>(
  filas: T[]
): { reintentar: T[]; saltados: { id: string; motivo: string }[] } {
  const reintentar: T[] = [];
  const saltados: { id: string; motivo: string }[] = [];
  for (const f of filas) {
    if (f.divergencia) {
      saltados.push({
        id: f.id,
        motivo:
          `el evento está divergido (${f.divergencia}) y reintentar pisaría en Google lo que alguien hizo ` +
          `del otro lado: lo resuelve destrabar`,
      });
    } else {
      reintentar.push(f);
    }
  }
  return { reintentar, saltados };
}

export interface DeLosPendientes {
  /** Los que volvieron a entrar y quedaron limpios. */
  limpiados: number;
  /** Los que Google volvió a rechazar: quedan con el mensaje nuevo. */
  siguen: number;
  /** Los que resultaron estar borrados en Google: pasaron a divergidos. */
  divergidos: number;
  /** Los que no se tocaron por estar divergidos. */
  saltados: number;
  /** Una frase por cada cosa que no quedó bien, con el evento nombrado. */
  fallos: string[];
}

const textoDe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const nombrar = (f: { id: string; titulo: string; casilla: string }) => `«${f.titulo}» (${f.id}, ${f.casilla})`;

/**
 * Reintenta los `google_pendiente`. **No tira por un evento**: cada uno va por su
 * cuenta. Tira sólo si no puede leer la cola.
 *
 * Qué acción usa: sin `google_event_id` es `crear`, que es idempotente (el id
 * sale de la fila, y si ya existía en Google lo pisa con lo que dice el SdG);
 * con id es `actualizar`, y **nunca `crear` ni `restaurar`**: un evento que
 * alguien borró en Google contesta 200 `cancelled` al PATCH, y
 * `escribirEnGoogle` lo vuelve una divergencia `borrado` en vez de resucitarlo.
 *
 * Lo que sale bien limpia el pendiente; lo que falla de nuevo se queda con el
 * mensaje **nuevo** de Google y no con el viejo
 * (`columnasDespuesDeEscribir` → `parPendiente`). Los tres pares de columnas
 * los escriben `parPendiente`, `parDivergencia` y `parEscrito`, y nadie más.
 */
export async function reintentarLosPendientes(
  supabase: SupabaseClient,
  ahora: Date = new Date(),
  limite: number = Infinity
): Promise<DeLosPendientes> {
  const r: DeLosPendientes = { limpiados: 0, siguen: 0, divergidos: 0, saltados: 0, fallos: [] };

  const filas = await traerTodo<PendienteLeido>((desde, hasta) =>
    supabase
      .from("agenda_eventos")
      .select("id, titulo, descripcion, lugar, inicio, fin, casilla, google_event_id, divergencia")
      .not("google_pendiente", "is", null)
      .order("id")
      .range(desde, hasta)
      .returns<PendienteLeido[]>()
  );

  const { reintentar, saltados } = quePendientesReintentar(filas);
  r.saltados = saltados.length;

  const marca = ahora.toISOString();
  for (let i = 0; i < reintentar.length; i++) {
    const f = reintentar[i];
    if (Date.now() >= limite) {
      r.fallos.push(
        `Se cortó la corrida por tiempo: quedaron ${reintentar.length - i} pendientes sin reintentar; ` +
          `siguen en la cola para mañana.`
      );
      break;
    }

    const { data: invitados, error: errorDeInvitados } = await supabase
      .from("agenda_invitados")
      .select("email")
      .eq("evento_id", f.id);
    if (errorDeInvitados) {
      // No es un fallo de Google: el pendiente no se toca, para no tapar su diagnóstico.
      r.fallos.push(`${nombrar(f)}: no se pudieron leer los invitados para reintentar: ${errorDeInvitados.message}`);
      continue;
    }

    let evento: EventoParaGoogle;
    try {
      const correos = (invitados ?? []).map((i: { email: string }) => i.email.toLowerCase());
      const completo = eventoParaGoogle(f, correos, f.casilla);
      // Cero filas no es «no hay invitados»: la cola existe, entre otras cosas, para
      // eventos cuyos invitados no se pudieron guardar, y mandar `[]` en un PATCH
      // los borra de Google y les manda la cancelación. Sin saber quiénes son se
      // deja `undefined`: un PATCH no los toca y un PUT los lee de Google antes de
      // escribir (ver `restaurar` en `escribirEnGoogle.ts`). Es la misma regla que
      // `moverElEvento`.
      //
      // **Se pregunta por `completo.invitados` y no por `correos`**: `eventoParaGoogle`
      // les aplica `invitadosLimpios` y saca al dueño, así que una fila cuyo único
      // invitado fuera la propia casilla da `correos` de uno y un `completo` vacío, y
      // el `PATCH` con `attendees: []` borraría a todos y les mandaría la cancelación.
      evento = completo.invitados && completo.invitados.length > 0 ? completo : { ...completo, invitados: undefined };
    } catch (e) {
      r.fallos.push(`${nombrar(f)}: ${textoDe(e)}`);
      continue;
    }

    const enGoogle = await escribirEnGoogle(
      f.google_event_id ? "actualizar" : "crear",
      { casilla: f.casilla, google_event_id: f.google_event_id, inicio: f.inicio, fin: f.fin },
      evento
    );

    const errorAlAnotar = await anotarEnLaFila(supabase, f.id, columnasDespuesDeEscribir(enGoogle, marca));
    const alAnotar = errorAlAnotar
      ? ` Tampoco se pudo anotar en la fila, ni en dos intentos (${errorAlAnotar}).`
      : "";

    if (enGoogle.pendiente) {
      r.siguen++;
      r.fallos.push(`${nombrar(f)}: Google volvió a rechazarlo. Google dijo: ${enGoogle.pendiente}.${alAnotar}`);
    } else if (errorAlAnotar) {
      // Google lo recibió y la fila sigue diciendo que falta: se reintenta mañana,
      // y crear/actualizar con el mismo contenido no duplica nada.
      r.fallos.push(`${nombrar(f)}: Google lo recibió pero no se pudo limpiar el pendiente: ${errorAlAnotar}.`);
    } else if (enGoogle.divergencia) {
      r.divergidos++;
    } else {
      r.limpiados++;
    }
  }
  return r;
}
