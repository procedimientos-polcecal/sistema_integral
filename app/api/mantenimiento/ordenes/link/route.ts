import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";

// POST /api/mantenimiento/ordenes/link
// Vincula (o desvincula, si schedule_id es null) una OT existente a un mantenimiento.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { work_order_id, schedule_id } = await request.json();
  if (!work_order_id) {
    return NextResponse.json({ error: "OT requerida" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ordenes_trabajo")
    .update({ schedule_id: schedule_id || null })
    .eq("id", work_order_id)
    .select("id, ot_number, schedule_id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
