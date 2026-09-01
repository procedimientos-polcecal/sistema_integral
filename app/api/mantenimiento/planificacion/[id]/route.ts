import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";

type Params = { params: Promise<{ id: string }> };

// Verifica sesión + nivel de edición en Mantenimiento. Devuelve una respuesta
// de error (o null si OK) junto con el cliente de sesión ya autenticado.
async function requireEditor() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }), supabase, user: null };
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return { error: NextResponse.json({ error: "Sin permisos" }, { status: 403 }), supabase, user: null };
  }
  return { error: null, supabase, user };
}

// GET — plan + items
export async function GET(_: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: plan, error } = await supabase
    .from("planificacion_diaria")
    .select("*, created_by_user:created_by(nombre, apellido), planificacion_diaria_items(*, assigned_user:assigned_to(nombre, apellido))")
    .eq("id", id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: plan });
}

// PATCH — agregar/quitar/editar ítems, o actualizar cabecera del plan
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const { error: authErr, supabase } = await requireEditor();
  if (authErr) return authErr;

  const body = await cuerpoJson(request);

  if (body.action === "add_item") {
    const { work_order_id, ot_number, especialidad, sector_raw, equipo_raw,
            descripcion, repuesto, fecha_ejecucion, assigned_to, assigned_name, notas_item } = body;

    const { data: existing } = await supabase
      .from("planificacion_diaria_items")
      .select("id").eq("plan_id", id).eq("work_order_id", work_order_id ?? "").maybeSingle();
    if (existing) return NextResponse.json({ error: "Esta OT ya está en el plan" }, { status: 400 });

    const { count } = await supabase
      .from("planificacion_diaria_items").select("id", { count: "exact", head: true }).eq("plan_id", id);

    const { data, error } = await supabase.from("planificacion_diaria_items").insert({
      plan_id: id, work_order_id, ot_number, especialidad, sector_raw,
      equipo_raw, descripcion, repuesto, fecha_ejecucion: fecha_ejecucion || null,
      assigned_to: assigned_to || null, assigned_name: assigned_name?.trim() || null,
      notas_item: notas_item?.trim() || null, orden: count ?? 0,
    }).select("*, assigned_user:assigned_to(nombre, apellido)").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  if (body.action === "remove_item") {
    const { item_id } = body;
    await supabase.from("planificacion_diaria_items").delete().eq("id", item_id);
    return NextResponse.json({ success: true });
  }

  if (body.action === "update_item") {
    const { item_id, assigned_to, assigned_name, notas_item, fecha_ejecucion } = body;
    const { data, error } = await supabase.from("planificacion_diaria_items")
      .update({ assigned_to: assigned_to || null, assigned_name: assigned_name?.trim() || null,
                notas_item: notas_item?.trim() || null, fecha_ejecucion: fecha_ejecucion || null })
      .eq("id", item_id).select("*, assigned_user:assigned_to(nombre, apellido)").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  const { titulo, notas } = body;
  const { data, error } = await supabase.from("planificacion_diaria")
    .update({ titulo: titulo?.trim() || null, notas: notas?.trim() || null })
    .eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// DELETE — eliminar plan
export async function DELETE(_: Request, { params }: Params) {
  const { id } = await params;
  const { error: authErr, supabase } = await requireEditor();
  if (authErr) return authErr;
  await supabase.from("planificacion_diaria").delete().eq("id", id);
  return NextResponse.json({ success: true });
}
