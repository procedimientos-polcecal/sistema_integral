import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check, puede_editar_check } from "@/lib/rrhh/route-utils";
import { recalcularEmpleadoPeriodo } from "@/lib/rrhh/engine/recalcular";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const employeeId = url.searchParams.get("employeeId");

  let query = supabase
    .from("vacaciones")
    .select("*, empleados(id, legajo, nombre, apellido)")
    .order("fecha_desde", { ascending: false });
  if (employeeId) query = query.eq("empleado_id", employeeId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await request.json();
  const { employeeId, anioCorrespondiente, fechaDesde, fechaHasta, diasTomados, observaciones } = body;
  if (!employeeId || !fechaDesde || !fechaHasta || !Number.isInteger(diasTomados) || diasTomados <= 0) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const { data: periodo, error } = await supabase
    .from("vacaciones")
    .insert({
      empleado_id: employeeId,
      anio_correspondiente: anioCorrespondiente ?? new Date().getFullYear(),
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      dias_tomados: diasTomados,
      observaciones: observaciones || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recalcularEmpleadoPeriodo(supabase, employeeId, new Date(fechaDesde), new Date(fechaHasta));
  return NextResponse.json(periodo, { status: 201 });
}
