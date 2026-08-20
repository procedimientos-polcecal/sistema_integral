import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";

/**
 * Fusiona esta ubicacion dentro de otra: mueve los requerimientos al destino y
 * borra la de origen.
 *
 * Existe porque la planilla trae variantes mal escritas del mismo lugar
 * ("Autoelevador HCMG" por "Autoelevador XCMG"), y sin esto quedan dos
 * ubicaciones para la misma maquina y el gasto se parte en dos.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenes permiso para administrar ubicaciones" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const destinoId = String(body?.destino_id ?? "");
  if (!destinoId) return NextResponse.json({ error: "Falta la ubicacion de destino" }, { status: 400 });
  if (destinoId === id) return NextResponse.json({ error: "No se puede fusionar consigo misma" }, { status: 400 });

  const admin = createAdminClient();

  const { data: destino } = await admin
    .from("compras_ubicaciones").select("id, nombre").eq("id", destinoId).maybeSingle();
  if (!destino) return NextResponse.json({ error: "La ubicacion de destino no existe" }, { status: 404 });

  const { count } = await admin
    .from("compras_requerimientos")
    .select("id", { count: "exact", head: true })
    .eq("ubicacion_id", id);

  const { error: errorMover } = await admin
    .from("compras_requerimientos")
    .update({ ubicacion_id: destinoId })
    .eq("ubicacion_id", id);
  if (errorMover) return NextResponse.json({ error: errorMover.message }, { status: 400 });

  const { error: errorBorrar } = await admin.from("compras_ubicaciones").delete().eq("id", id);
  if (errorBorrar) return NextResponse.json({ error: errorBorrar.message }, { status: 400 });

  return NextResponse.json({ ok: true, movidos: count ?? 0, destino: destino.nombre });
}
