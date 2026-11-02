import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Divergencia } from "./divergencia";
import { ES_UUID } from "./sesion";

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
