import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { es_admin_check } from "@/lib/rrhh/route-utils";
import { recalcularEmpleadoPeriodo } from "@/lib/rrhh/engine/recalcular";

// horasNormales: null pide restablecer al cálculo automático (se ignoran
// horasExtra50/100 en ese caso). Si no es null, las tres reemplazan al
// cálculo automático tal cual, cada una por separado.
export async function PUT(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const { employeeId, fecha, horasNormales, horasExtra50, horasExtra100 } = await request.json();
  if (!employeeId || !fecha) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

  const admin = createAdminClient();

  if (horasNormales === null) {
    await admin.from("calculos_diarios").update({ horas_manual: false }).eq("empleado_id", employeeId).eq("fecha", fecha);
    await recalcularEmpleadoPeriodo(supabase, employeeId, new Date(fecha), new Date(fecha));
    const { data } = await admin.from("calculos_diarios").select("*").eq("empleado_id", employeeId).eq("fecha", fecha).single();
    return NextResponse.json(data);
  }

  const normales = Number(horasNormales);
  const extra50 = Number(horasExtra50 ?? 0);
  const extra100 = Number(horasExtra100 ?? 0);
  if ([normales, extra50, extra100].some((h) => Number.isNaN(h) || h < 0 || h > 24)) {
    return NextResponse.json({ error: "Horas inválidas" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("calculos_diarios")
    .update({
      horas_normales: normales,
      horas_extra_50: extra50,
      horas_extra_100: extra100,
      horas_manual: true,
      ausente: false,
      extras_validadas: false,
      validado_por_id: null,
      fecha_validacion: null,
    })
    .eq("empleado_id", employeeId)
    .eq("fecha", fecha)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
