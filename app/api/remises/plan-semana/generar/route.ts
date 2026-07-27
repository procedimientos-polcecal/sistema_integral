import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/remises/route-utils";
import { generarRutasParaTurno } from "@/lib/remises/generarRutas";

/** "▶ Generar rutas" desde Semana: copia el plan de ese día a la asistencia real y genera. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await request.json();
  const { fecha, turnoId, tipo } = body;
  if (!fecha || !turnoId || (tipo !== "ida" && tipo !== "vuelta")) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const { data: plan } = await supabase
    .from("remises_plan_semana")
    .select("empleado_id")
    .eq("fecha", fecha)
    .eq("turno_id", turnoId)
    .eq("tipo", tipo);
  const empleadoIds = (plan ?? []).map((p) => p.empleado_id);
  if (!empleadoIds.length) return NextResponse.json({ error: "No hay empleados planificados para este día" }, { status: 400 });

  // Sincroniza con la asistencia real del día (mismo criterio que Hoy).
  const filas = empleadoIds.map((empleado_id) => ({ empleado_id, fecha, turno_id: turnoId }));
  await supabase.from("remises_asistencia").upsert(filas, { onConflict: "empleado_id,fecha,turno_id", ignoreDuplicates: true });

  const resultado = await generarRutasParaTurno(supabase, { fecha, turnoId, tipo, empleadoIdsOverride: empleadoIds });
  if ("error" in resultado) return NextResponse.json({ error: resultado.error }, { status: 400 });
  return NextResponse.json(resultado);
}
