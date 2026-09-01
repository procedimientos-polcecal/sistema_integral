import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check, puede_editar_check } from "@/lib/remises/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const fecha = url.searchParams.get("fecha");
  const turnoId = url.searchParams.get("turnoId");
  if (!fecha || !turnoId) return NextResponse.json({ error: "Faltan fecha/turnoId" }, { status: 400 });

  const { data, error } = await supabase
    .from("remises_asistencia")
    .select("empleado_id")
    .eq("fecha", fecha)
    .eq("turno_id", turnoId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []).map((r) => r.empleado_id));
}

/** Toggle de presencia de un empleado en fecha+turno (existe la fila = presente). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const { empleadoId, fecha, turnoId } = body;
  if (!empleadoId || !fecha || !turnoId) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const { data: existente } = await supabase
    .from("remises_asistencia")
    .select("empleado_id")
    .eq("empleado_id", empleadoId)
    .eq("fecha", fecha)
    .eq("turno_id", turnoId)
    .maybeSingle();

  if (existente) {
    await supabase.from("remises_asistencia").delete().eq("empleado_id", empleadoId).eq("fecha", fecha).eq("turno_id", turnoId);
    return NextResponse.json({ presente: false });
  }
  await supabase.from("remises_asistencia").insert({ empleado_id: empleadoId, fecha, turno_id: turnoId });
  return NextResponse.json({ presente: true });
}
