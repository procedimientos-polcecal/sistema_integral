import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/remises/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";

const HORA_REGEX = /^\d{2}:\d{2}$/;

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const data: Record<string, unknown> = {};
  if (body.nombre !== undefined) {
    const nombre = String(body.nombre).trim();
    if (!nombre) return NextResponse.json({ error: "Ingresá un nombre" }, { status: 400 });
    data.nombre = nombre;
  }
  if (body.horaInicio !== undefined) {
    if (!HORA_REGEX.test(body.horaInicio)) return NextResponse.json({ error: "Hora de inicio inválida" }, { status: 400 });
    data.hora_inicio = body.horaInicio;
  }
  if (body.horaFin !== undefined) {
    if (!HORA_REGEX.test(body.horaFin)) return NextResponse.json({ error: "Hora de fin inválida" }, { status: 400 });
    data.hora_fin = body.horaFin;
  }
  if (body.color !== undefined) data.color = body.color;
  if (body.activo !== undefined) data.activo = body.activo;

  const { data: turno, error } = await supabase.from("remises_turnos").update(data).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(turno);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const { count } = await supabase.from("remises_turnos").select("id", { count: "exact", head: true });
  if ((count ?? 0) <= 1) {
    return NextResponse.json({ error: "Debe quedar al menos un turno" }, { status: 400 });
  }

  // remises_asistencia/remises_plan_semana son datos de trabajo del día a
  // día y cascadean solos (a diferencia del original, que también borraba
  // las rutas ya generadas). hojas_ruta/remises_plantillas son historial —
  // acá se protegen en vez de perderse: bloquear en vez de cascada.
  const [hojas, plantillas] = await Promise.all([
    supabase.from("hojas_ruta").select("id", { count: "exact", head: true }).eq("turno_id", id),
    supabase.from("remises_plantillas").select("id", { count: "exact", head: true }).eq("turno_id", id),
  ]);
  if ((hojas.count ?? 0) + (plantillas.count ?? 0) > 0) {
    return NextResponse.json(
      { error: "No se puede eliminar: el turno tiene hojas de ruta o plantillas asociadas. Desactivalo en vez de eliminarlo." },
      { status: 400 }
    );
  }

  const { error } = await supabase.from("remises_turnos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
