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
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sincronizar las órdenes de servicio requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const r = await sincronizarOrdenesDeServicio();

  return r.ok
    ? NextResponse.json(r.datos)
    : NextResponse.json({ error: r.error, ...r.datos }, { status: r.status });
}
