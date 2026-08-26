import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  // Una ejecución cuelga de un mantenimiento programado **o** de una orden de
  // trabajo: la mayor parte del trabajo de la planta entra por una OT.
  const { data: schedule } = body.schedule_id
    ? await supabase
        .from("mantenimientos_programados")
        .select("*, equipos(name, code)")
        .eq("id", body.schedule_id)
        .single()
    : { data: null };

  const { data: orden } = body.work_order_id
    ? await supabase
        .from("ordenes_trabajo")
        .select("equipment_id")
        .eq("id", body.work_order_id)
        .maybeSingle()
    : { data: null };

  if (!schedule && !orden) {
    return NextResponse.json(
      { error: "La ejecución tiene que ser de un mantenimiento programado o de una OT" },
      { status: 400 }
    );
  }

  const { data: execution, error } = await supabase
    .from("mantenimientos_ejecuciones")
    .insert({
      schedule_id:          body.schedule_id ?? null,
      work_order_id:        body.work_order_id ?? null,
      equipment_id:         schedule?.equipment_id ?? orden?.equipment_id ?? null,
      executed_by:          user.id,
      execution_status:     body.execution_status,
      executed_at:          body.executed_at,
      duration_hours:       body.duration_hours ?? null,
      observations:         body.observations ?? null,
      checklist_snapshot:   body.checklist_snapshot ?? null,
      checklist_responses:  body.checklist_responses ?? null,
      photo_urls:           body.photo_urls ?? [],
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Avanza la próxima fecha si el mantenimiento se completó.
  if (body.execution_status === "completado" && schedule) {
    const nextDate = body.next_date_override || calcNextDate(schedule);
    if (nextDate) {
      await supabase
        .from("mantenimientos_programados")
        .update({ next_date: nextDate, last_executed_at: body.executed_at })
        .eq("id", body.schedule_id);
    }
  }

  return NextResponse.json({ data: execution });
}

function calcNextDate(schedule: any): string | null {
  if (!schedule.next_date) return null;
  const base = new Date(schedule.next_date + "T00:00:00");
  const INTERVALS: Record<string, number> = {
    DIARIO: 1, SEMANAL: 7, QUINCENAL: 15, MENSUAL: 30,
    TRIMESTRAL: 90, SEMESTRAL: 180, ANUAL: 365,
  };
  if (schedule.schedule_type === "FECHA_FIJA") return null;
  if (schedule.schedule_type === "PERSONALIZADO" && schedule.interval_days) {
    base.setDate(base.getDate() + Number(schedule.interval_days));
  } else {
    const days = INTERVALS[schedule.schedule_type];
    if (!days) return null;
    base.setDate(base.getDate() + days);
  }
  return base.toISOString().split("T")[0];
}
