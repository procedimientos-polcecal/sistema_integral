import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { sincronizarOrdenesDeServicio } from "@/lib/mantenimiento/sincronizar";

export const maxDuration = 300;

/**
 * Trae las órdenes de servicio de su planilla, a pedido de alguien.
 *
 * El trabajo está en `lib/mantenimiento/sincronizar`: acá sólo se comprueba
 * quién lo pide. El reloj llama a la misma función sin pasar por acá.
 */
/**
 * El freno de mano del borrado, levantado a mano.
 *
 * Cuando la planilla dejó de traer más filas que el tope, la sincronización no
 * borra nada y lo dice. Si ese borrado es de verdad —una limpieza grande—,
 * quien lo miró lo confirma repitiendo la llamada con `?confirmar_borrado=1`.
 *
 * Va como parámetro y no como opción guardada a propósito: vale para **esta**
 * corrida. El cron nunca lo manda, así que un borrado masivo siempre lo
 * autoriza una persona que vio el número.
 */
const confirmaElBorrado = (request: Request) =>
  new URL(request.url).searchParams.get("confirmar_borrado") === "1";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sincronizar las órdenes de servicio requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const r = await sincronizarOrdenesDeServicio({ sinFreno: confirmaElBorrado(request) });

  return r.ok
    ? NextResponse.json(r.datos)
    : NextResponse.json({ error: r.error, ...r.datos }, { status: r.status });
}
