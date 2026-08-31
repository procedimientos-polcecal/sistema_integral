import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/rrhh/route-utils";
import { recalcularVentanaEnSegundoPlano } from "@/lib/rrhh/recalculoProgramado";

const HORA_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await request.json();
  const data: Record<string, unknown> = {};
  if (body.nombre !== undefined) data.nombre = body.nombre;
  if (body.horaInicio !== undefined) {
    if (!HORA_REGEX.test(body.horaInicio)) return NextResponse.json({ error: "Hora de inicio inválida" }, { status: 400 });
    data.hora_inicio = body.horaInicio;
  }
  if (body.horaFin !== undefined) {
    if (!HORA_REGEX.test(body.horaFin)) return NextResponse.json({ error: "Hora de fin inválida" }, { status: 400 });
    data.hora_fin = body.horaFin;
  }
  if (body.toleranciaMinutos !== undefined) data.tolerancia_minutos = body.toleranciaMinutos;
  if (body.activo !== undefined) data.activo = body.activo;

  const { data: jornada, error } = await supabase.from("jornadas").update(data).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Cambiar el catálogo de turnos cambia cómo se ajusta CADA fichada, así que
  // se recalcula la ventana. Va en segundo plano para no convertir un
  // "Guardar" de dos campos en una espera de varios segundos; si la función
  // se corta antes de terminar, la corrida de la madrugada lo arregla.
  recalcularVentanaEnSegundoPlano(supabase);
  return NextResponse.json(jornada);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const { error } = await supabase.from("jornadas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Cambiar el catálogo de turnos cambia cómo se ajusta CADA fichada, así que
  // se recalcula la ventana. Va en segundo plano para no convertir un
  // "Guardar" de dos campos en una espera de varios segundos; si la función
  // se corta antes de terminar, la corrida de la madrugada lo arregla.
  recalcularVentanaEnSegundoPlano(supabase);
  return new NextResponse(null, { status: 204 });
}
