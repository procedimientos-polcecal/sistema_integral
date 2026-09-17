import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Descarta una notificación del globo del Inicio para el usuario que la pide.
 * Guarda la cantidad que tenía en ese momento: `GET /api/home/resumen` la
 * vuelve a mostrar sólo si esa cantidad creció después.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const notificacionId = typeof body?.id === "string" ? body.id : null;
  const cantidad = typeof body?.cantidad === "number" ? body.cantidad : null;
  if (!notificacionId || cantidad === null) {
    return NextResponse.json({ error: "Faltan id o cantidad" }, { status: 400 });
  }

  const { error } = await supabase
    .from("notificaciones_descartes")
    .upsert(
      { usuario_id: user.id, notificacion_id: notificacionId, cantidad_vista: cantidad, descartado_en: new Date().toISOString() },
      { onConflict: "usuario_id,notificacion_id" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
