import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";

const CAMPOS = ["nombre", "tipo", "sector_id", "equipo_id", "orden", "activo"] as const;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenes permiso para administrar ubicaciones" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Cuerpo invalido" }, { status: 400 });

  const cambios: Record<string, unknown> = {};
  for (const c of CAMPOS) if (c in body) cambios[c] = body[c];

  if ("nombre" in cambios) {
    const nombre = String(cambios.nombre ?? "").trim();
    if (!nombre) return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    cambios.nombre = nombre;
  }
  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No se envio ningun cambio" }, { status: 400 });
  }

  const { data, error } = await createAdminClient()
    .from("compras_ubicaciones").update(cambios).eq("id", id).select("*").single();

  if (error) {
    const mensaje = error.code === "23505" ? "Ya existe una ubicacion con ese nombre" : error.message;
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }
  return NextResponse.json(data);
}

/**
 * Borra una ubicacion. Solo si no la usa ningun requerimiento: si la usa, se
 * fusiona con otra o se desactiva, pero no se pierde el dato de donde se
 * necesitaba cada cosa.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenes permiso para administrar ubicaciones" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { count } = await admin
    .from("compras_requerimientos")
    .select("id", { count: "exact", head: true })
    .eq("ubicacion_id", id);

  if (count && count > 0) {
    return NextResponse.json(
      { error: `La usan ${count} requerimientos. Fusionala con otra o desactivala.` },
      { status: 409 }
    );
  }

  const { error } = await admin.from("compras_ubicaciones").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
