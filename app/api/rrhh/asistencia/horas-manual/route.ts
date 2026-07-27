import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { es_admin_check } from "@/lib/rrhh/route-utils";
import { recalcularEmpleadoPeriodo } from "@/lib/rrhh/engine/recalcular";

export async function PUT(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const { employeeId, fecha, horasTrabajadas } = await request.json();
  if (!employeeId || !fecha) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

  const admin = createAdminClient();

  if (horasTrabajadas === null) {
    await admin.from("calculos_diarios").update({ horas_manual: false }).eq("empleado_id", employeeId).eq("fecha", fecha);
    await recalcularEmpleadoPeriodo(supabase, employeeId, new Date(fecha), new Date(fecha));
    const { data } = await admin.from("calculos_diarios").select("*").eq("empleado_id", employeeId).eq("fecha", fecha).single();
    return NextResponse.json(data);
  }

  const horas = Number(horasTrabajadas);
  if (Number.isNaN(horas) || horas < 0 || horas > 24) {
    return NextResponse.json({ error: "Horas inválidas" }, { status: 400 });
  }

  const { data: existente } = await admin
    .from("calculos_diarios")
    .select("horas_extra_50, horas_extra_100")
    .eq("empleado_id", employeeId)
    .eq("fecha", fecha)
    .single();
  if (!existente) return NextResponse.json({ error: "No hay cálculo para ese día" }, { status: 404 });

  const horasNormales = Math.max(0, horas - Number(existente.horas_extra_50) - Number(existente.horas_extra_100));
  const { data, error } = await admin
    .from("calculos_diarios")
    .update({ horas_normales: horasNormales, horas_manual: true, ausente: false })
    .eq("empleado_id", employeeId)
    .eq("fecha", fecha)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
