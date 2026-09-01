import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/rrhh/route-utils";
import { recalcularEmpleadoPeriodo } from "@/lib/rrhh/engine/recalcular";
import { cuerpoJson } from "@/lib/core/cuerpo";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const { data: anterior } = await supabase.from("vacaciones").select("*").eq("id", id).single();
  if (!anterior) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const body = await cuerpoJson(request);
  const data: Record<string, unknown> = {};
  if (body.employeeId !== undefined) data.empleado_id = body.employeeId;
  if (body.anioCorrespondiente !== undefined) data.anio_correspondiente = body.anioCorrespondiente;
  if (body.fechaDesde !== undefined) data.fecha_desde = body.fechaDesde;
  if (body.fechaHasta !== undefined) data.fecha_hasta = body.fechaHasta;
  if (body.diasTomados !== undefined) data.dias_tomados = body.diasTomados;
  if (body.observaciones !== undefined) data.observaciones = body.observaciones || null;

  const { data: periodo, error } = await supabase.from("vacaciones").update(data).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recalcularEmpleadoPeriodo(supabase, anterior.empleado_id, new Date(anterior.fecha_desde), new Date(anterior.fecha_hasta));
  if (
    periodo.empleado_id !== anterior.empleado_id ||
    periodo.fecha_desde !== anterior.fecha_desde ||
    periodo.fecha_hasta !== anterior.fecha_hasta
  ) {
    await recalcularEmpleadoPeriodo(supabase, periodo.empleado_id, new Date(periodo.fecha_desde), new Date(periodo.fecha_hasta));
  }
  return NextResponse.json(periodo);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const { data: periodo, error } = await supabase.from("vacaciones").delete().eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recalcularEmpleadoPeriodo(supabase, periodo.empleado_id, new Date(periodo.fecha_desde), new Date(periodo.fecha_hasta));
  return new NextResponse(null, { status: 204 });
}
