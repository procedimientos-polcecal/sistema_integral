import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/remises/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const { fecha, turnoId, tipo, todos } = body;
  if (!fecha || !turnoId || !tipo) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  if (!todos) {
    await supabase.from("remises_plan_semana").delete().eq("fecha", fecha).eq("turno_id", turnoId).eq("tipo", tipo);
    return NextResponse.json({ ok: true });
  }

  const { data: empleados } = await supabase.from("empleados").select("id").eq("activo", true);
  const filas = (empleados ?? []).map((e) => ({ empleado_id: e.id, fecha, turno_id: turnoId, tipo }));
  if (filas.length > 0) {
    await supabase.from("remises_plan_semana").upsert(filas, { onConflict: "empleado_id,fecha,turno_id,tipo", ignoreDuplicates: true });
  }
  return NextResponse.json({ ok: true });
}
