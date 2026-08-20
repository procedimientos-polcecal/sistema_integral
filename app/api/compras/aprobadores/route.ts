import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";

/**
 * Alias con el que cada aprobador figura en el desplegable de la planilla.
 * Sin esto, al aprobar se escribiria el nombre completo y la celda quedaria
 * fuera de la lista de valores validos.
 */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenes permiso para configurar Compras" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const usuarioId = String(body?.usuario_id ?? "");
  const alias = String(body?.alias_planilla ?? "").trim();
  if (!usuarioId) return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });

  const admin = createAdminClient();

  // Alias vacio = se quita el mapeo.
  if (!alias) {
    const { error } = await admin.from("compras_aprobadores").delete().eq("usuario_id", usuarioId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, alias_planilla: null });
  }

  const { data, error } = await admin
    .from("compras_aprobadores")
    .upsert({ usuario_id: usuarioId, alias_planilla: alias }, { onConflict: "usuario_id" })
    .select("usuario_id, alias_planilla")
    .single();

  if (error) {
    const mensaje = error.code === "23505"
      ? "Ese alias ya esta asignado a otra persona"
      : error.message;
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }
  return NextResponse.json(data);
}
