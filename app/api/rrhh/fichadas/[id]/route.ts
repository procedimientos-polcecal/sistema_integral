import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/rrhh/route-utils";
import { recalcularEmpleadoPeriodo } from "@/lib/rrhh/engine/recalcular";
import { localDateTime, toUtcDateOnly } from "@/lib/rrhh/dates";

function parseHoraDePared(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, y, m, d, h, mi, s] = match;
  const fecha = toUtcDateOnly(Number(y), Number(m) - 1, Number(d));
  return localDateTime(fecha, Number(h), Number(mi), s ? Number(s) : 0);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await request.json();
  const data: Record<string, unknown> = {};
  if (body.employeeId !== undefined) data.empleado_id = body.employeeId;
  if (body.fecha !== undefined) data.fecha = body.fecha;
  if (body.horaEntrada !== undefined) {
    const entrada = parseHoraDePared(body.horaEntrada);
    if (!entrada) return NextResponse.json({ error: "Hora de entrada inválida" }, { status: 400 });
    data.hora_entrada = entrada.toISOString();
  }
  if (body.horaSalida !== undefined) {
    const salida = body.horaSalida ? parseHoraDePared(body.horaSalida) : null;
    data.hora_salida = salida ? salida.toISOString() : null;
  }
  if (body.observaciones !== undefined) data.observaciones = body.observaciones || null;

  const { data: fichada, error } = await supabase.from("fichadas").update(data).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recalcularEmpleadoPeriodo(supabase, fichada.empleado_id, new Date(fichada.fecha), new Date(fichada.fecha));
  return NextResponse.json(fichada);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const { data: fichada, error } = await supabase.from("fichadas").delete().eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recalcularEmpleadoPeriodo(supabase, fichada.empleado_id, new Date(fichada.fecha), new Date(fichada.fecha));
  return new NextResponse(null, { status: 204 });
}
