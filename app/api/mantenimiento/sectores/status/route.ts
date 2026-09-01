import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";

const VALID_STATUSES = ["ACTIVA", "PARADA", "EN_REPARACION"];
const REQUIRES_REASON = ["PARADA", "EN_REPARACION"];

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { sector_id, new_status, reason } = await cuerpoJson(request);

  if (!sector_id || !new_status) {
    return NextResponse.json({ error: "Sector y nuevo estado son requeridos" }, { status: 400 });
  }
  if (!VALID_STATUSES.includes(new_status)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }
  if (REQUIRES_REASON.includes(new_status) && !reason?.trim()) {
    return NextResponse.json({ error: "Se requiere una justificación para este cambio de estado" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: sector } = await admin
    .from("sectores").select("status").eq("id", sector_id).single();
  if (!sector) return NextResponse.json({ error: "Sector no encontrado" }, { status: 404 });

  const { error: updateErr } = await admin
    .from("sectores").update({ status: new_status }).eq("id", sector_id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  await admin.from("sectores_status_log").insert({
    sector_id,
    old_status:  sector.status ?? null,
    new_status,
    reason:      reason?.trim() || null,
    changed_by:  user.id,
  });

  return NextResponse.json({ success: true });
}
