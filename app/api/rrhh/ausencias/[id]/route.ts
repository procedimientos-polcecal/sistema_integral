import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/rrhh/route-utils";
import { recalcularEmpleadoPeriodo } from "@/lib/rrhh/engine/recalcular";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await request.json();
  const data: Record<string, unknown> = {};
  if (body.employeeId !== undefined) data.empleado_id = body.employeeId;
  if (body.fechaDesde !== undefined) data.fecha_desde = body.fechaDesde;
  if (body.fechaHasta !== undefined) data.fecha_hasta = body.fechaHasta;
  if (body.tipo !== undefined) data.tipo = body.tipo;
  if (body.justificada !== undefined) data.justificada = body.justificada;
  if (body.observaciones !== undefined) data.observaciones = body.observaciones || null;

  const { data: ausencia, error } = await supabase.from("ausencias").update(data).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recalcularEmpleadoPeriodo(supabase, ausencia.empleado_id, new Date(ausencia.fecha_desde), new Date(ausencia.fecha_hasta));
  return NextResponse.json(ausencia);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const { data: ausencia, error } = await supabase.from("ausencias").delete().eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recalcularEmpleadoPeriodo(supabase, ausencia.empleado_id, new Date(ausencia.fecha_desde), new Date(ausencia.fecha_hasta));
  return new NextResponse(null, { status: 204 });
}
