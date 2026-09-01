import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/rrhh/route-utils";
import { recalcularEmpleadoPeriodo, getConfigLiquidacion } from "@/lib/rrhh/engine/recalcular";
import { cuerpoJson } from "@/lib/core/cuerpo";

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const { data: { user } } = await supabase.auth.getUser();
  const body = await cuerpoJson(request);
  const { employeeId, tipo, fechaDesde, fechaHasta } = body;
  if (!employeeId || (tipo !== "QUINCENAL" && tipo !== "MENSUAL") || !fechaDesde || !fechaHasta) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const { data: empleado } = await supabase
    .from("empleados")
    .select("id, valor_hora_normal")
    .eq("id", employeeId)
    .single();
  if (!empleado) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  await recalcularEmpleadoPeriodo(supabase, employeeId, new Date(fechaDesde), new Date(fechaHasta));

  const { data: dias } = await supabase
    .from("calculos_diarios")
    .select("horas_normales, horas_extra_50, horas_extra_100, extras_validadas")
    .eq("empleado_id", employeeId)
    .gte("fecha", fechaDesde)
    .lte("fecha", fechaHasta);
  const config = await getConfigLiquidacion(supabase);

  const horasNormales = (dias ?? []).reduce((a, d) => a + Number(d.horas_normales), 0);
  // Las horas extra solo cuentan para la liquidación una vez que RRHH las validó
  // día por día; las que quedan pendientes se informan aparte para que se sepa
  // que faltan validar (no se pagan solas por default).
  const diasValidados = (dias ?? []).filter((d) => d.extras_validadas);
  const diasSinValidar = (dias ?? []).filter(
    (d) => !d.extras_validadas && (Number(d.horas_extra_50) > 0 || Number(d.horas_extra_100) > 0)
  );
  const horasExtra50 = diasValidados.reduce((a, d) => a + Number(d.horas_extra_50), 0);
  const horasExtra100 = diasValidados.reduce((a, d) => a + Number(d.horas_extra_100), 0);
  const horasExtra50SinValidar = diasSinValidar.reduce((a, d) => a + Number(d.horas_extra_50), 0);
  const horasExtra100SinValidar = diasSinValidar.reduce((a, d) => a + Number(d.horas_extra_100), 0);

  const valorHora = Number(empleado.valor_hora_normal);
  const montoNormal = horasNormales * valorHora;
  const montoExtra50 = horasExtra50 * valorHora * config.multiplicadorExtra50;
  const montoExtra100 = horasExtra100 * valorHora * config.multiplicadorExtra100;
  const totalBruto = montoNormal + montoExtra50 + montoExtra100;

  const { data: liquidacion, error } = await supabase
    .from("liquidaciones")
    .insert({
      empleado_id: employeeId,
      tipo,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      horas_normales: horasNormales,
      horas_extra_50: horasExtra50,
      horas_extra_100: horasExtra100,
      monto_normal: montoNormal,
      monto_extra_50: montoExtra50,
      monto_extra_100: montoExtra100,
      total_bruto: totalBruto,
      generado_por_id: user!.id,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    {
      ...liquidacion,
      horasExtra50SinValidar,
      horasExtra100SinValidar,
      diasSinValidarCount: diasSinValidar.length,
    },
    { status: 201 }
  );
}
