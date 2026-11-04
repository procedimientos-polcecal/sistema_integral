import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cargarEvento } from "@/lib/agenda/cargar";
import { quienLlama } from "@/lib/agenda/sesion";

/**
 * Dar por vista una divergencia: **apaga la campana para quien aprieta, y nada
 * más**. No toca el evento ni lo destraba: sigue divergido y la sincronización
 * sigue sin escribirlo. Destrabar es otra ruta y es del dueño.
 *
 * Lo que se guarda es el `divergencia_el` que la fila tiene **en este momento**,
 * no un «visto: true». Si el evento vuelve a divergir, su `divergencia_el`
 * cambia, deja de coincidir con lo guardado y la alerta reaparece sola; un
 * booleano la taparía para siempre. Cada persona la da por vista por su cuenta
 * (la clave es `(evento_id, usuario_id)`), y por eso lo puede hacer cualquiera
 * que vea el evento, no sólo el dueño.
 *
 * Es un `upsert` y acá sí corresponde: `agenda_divergencias_vistas` tiene
 * policy de update, a diferencia de `agenda_invitados`.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const quien = await quienLlama(supabase);
  if (!quien.ok) return quien.respuesta;

  const cargado = await cargarEvento(supabase, id, quien.id, null);
  if (!cargado.ok) return cargado.respuesta;
  const { divergencia, divergencia_el } = cargado.evento;

  if (!divergencia || !divergencia_el) {
    return NextResponse.json(
      { error: "Ese evento ya no tiene una divergencia: puede que el dueño la haya destrabado" },
      { status: 409 }
    );
  }

  const { error } = await supabase
    .from("agenda_divergencias_vistas")
    .upsert(
      { evento_id: id, usuario_id: quien.id, divergencia_el },
      { onConflict: "evento_id,usuario_id" }
    );
  if (error) {
    return NextResponse.json(
      { error: `No se pudo dar por vista la divergencia: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ data: { evento_id: id, divergencia, divergencia_el, vista: true } });
}
