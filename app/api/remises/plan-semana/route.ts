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
  const tipo = url.searchParams.get("tipo");
  if (!fecha || !turnoId || !tipo) return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });

  const { data, error } = await supabase
    .from("remises_plan_semana")
    .select("empleado_id")
    .eq("fecha", fecha)
    .eq("turno_id", turnoId)
    .eq("tipo", tipo);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json((data ?? []).map((r) => r.empleado_id));
}

/** Toggle Va/No va de un empleado en fecha+turno+tipo (existe la fila = va). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const { empleadoId, fecha, turnoId, tipo } = body;
  if (!empleadoId || !fecha || !turnoId || !tipo) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const { data: existente } = await supabase
    .from("remises_plan_semana")
    .select("empleado_id")
    .eq("empleado_id", empleadoId)
    .eq("fecha", fecha)
    .eq("turno_id", turnoId)
    .eq("tipo", tipo)
    .maybeSingle();

  if (existente) {
    await supabase.from("remises_plan_semana").delete().eq("empleado_id", empleadoId).eq("fecha", fecha).eq("turno_id", turnoId).eq("tipo", tipo);
    return NextResponse.json({ va: false });
  }
  await supabase.from("remises_plan_semana").insert({ empleado_id: empleadoId, fecha, turno_id: turnoId, tipo });
  return NextResponse.json({ va: true });
}
