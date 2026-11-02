import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Divergencia } from "./divergencia";
import { ES_UUID } from "./sesion";
import { mensajeDeEventoDeOT } from "./pedido";

/** Lo que las rutas de un evento necesitan de su fila. */
export interface EventoCargado {
  id: string;
  titulo: string;
  descripcion: string | null;
  lugar: string | null;
  inicio: string;
  fin: string;
  dueno_id: string;
  casilla: string;
  google_event_id: string | null;
  divergencia: Divergencia | null;
  divergencia_el: string | null;
  ot_id: string | null;
  /** Los correos de los invitados, en minúscula. */
  invitados: string[];
}

/**
 * El 409 con que se rechaza modificar o borrar el evento de una OT, o `null` si
 * el evento no es de una OT.
 *
 * **El evento de una OT no es de quien lo mira: es de la orden.** Su horario
 * sale de la `fecha_ejecucion` y la sincronización lo reescribe cuando la
 * planilla la mueve. Si la Agenda dejara editarlo, la persona vería que su
 * cambio se guardó y después, en la corrida siguiente, desaparecer sin que nada
 * avise: la misma mentira que este diseño evita al no pisar un evento
 * divergido. Por eso es de sólo lectura en todas sus partes, no sólo en la hora
 * —el título, los invitados y el lugar los reescribe la OT igual—, y por eso la
 * condición es `ot_id` y no «cambió el horario».
 *
 * No alcanza a `visto` ni a `destrabar`: son la forma de resolver una
 * divergencia, y esa ruta no es editar el evento sino volver a atarlo.
 */
export async function rechazoDeEventoDeOT(
  supabase: SupabaseClient,
  evento: Pick<EventoCargado, "ot_id">,
  accion: "modificar" | "borrar"
): Promise<NextResponse | null> {
  if (!evento.ot_id) return null;
  // Si la lectura falla o no se tiene acceso a la OT, el rechazo sale igual: el
  // número es lo único que se pierde.
  const { data } = await supabase
    .from("ordenes_trabajo")
    .select("ot_number")
    .eq("id", evento.ot_id)
    .maybeSingle();
  return NextResponse.json(
    { error: mensajeDeEventoDeOT(accion, data?.ot_number ?? null) },
    { status: 409 }
  );
}

/**
 * Lee un evento para una ruta que lo va a tocar. `soloElDueno` decide si un
 * invitado que lo ve pero no es el dueño pasa o recibe un 403.
 *
 * RLS recorta la lectura a «míos o donde estoy invitado»: un evento ajeno
 * y no invitado vuelve como **404** y no como 403, para no confirmar que existe.
 * Un invitado sí lo ve, y a ése se lo rechaza con el motivo: sólo el dueño
 * modifica, borra o destraba.
 */
export async function cargarEvento(
  supabase: SupabaseClient,
  id: string,
  usuarioId: string,
  soloElDueno: { accion: string } | null
): Promise<{ ok: true; evento: EventoCargado } | { ok: false; respuesta: NextResponse }> {
  const noExiste = {
    ok: false as const,
    respuesta: NextResponse.json({ error: "No existe ese evento" }, { status: 404 }),
  };
  if (!ES_UUID.test(id)) return noExiste;

  const { data: fila, error } = await supabase
    .from("agenda_eventos")
    .select(
      "id, titulo, descripcion, lugar, inicio, fin, dueno_id, casilla, google_event_id, divergencia, divergencia_el, ot_id"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      respuesta: NextResponse.json({ error: `No se pudo leer el evento: ${error.message}` }, { status: 500 }),
    };
  }
  if (!fila) return noExiste;

  if (soloElDueno && fila.dueno_id !== usuarioId) {
    return {
      ok: false,
      respuesta: NextResponse.json(
        { error: `Sólo quien creó el evento puede ${soloElDueno.accion}` },
        { status: 403 }
      ),
    };
  }

  const { data: invitados, error: errorDeInvitados } = await supabase
    .from("agenda_invitados")
    .select("email")
    .eq("evento_id", id);
  if (errorDeInvitados) {
    return {
      ok: false,
      respuesta: NextResponse.json(
        { error: `No se pudieron leer los invitados: ${errorDeInvitados.message}` },
        { status: 500 }
      ),
    };
  }

  return {
    ok: true,
    evento: {
      ...fila,
      invitados: (invitados ?? []).map((i: { email: string }) => i.email.toLowerCase()),
    },
  };
}
