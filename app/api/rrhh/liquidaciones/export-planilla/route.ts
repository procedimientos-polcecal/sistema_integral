import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/rrhh/route-utils";
import { xlsxResponse } from "@/lib/core/xlsxExport";
import { recalcularEmpleadoPeriodo, getConfigLiquidacion } from "@/lib/rrhh/engine/recalcular";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");
  if (!desde || !hasta) return NextResponse.json({ error: "Faltan desde/hasta" }, { status: 400 });
  const fechaDesde = new Date(desde);
  const fechaHasta = new Date(hasta);

  const { data: empleados } = await supabase
    .from("empleados")
    .select("id, legajo, nombre, apellido, valor_hora_normal")
    .eq("activo", true)
    .order("apellido")
    .order("nombre");
  const config = await getConfigLiquidacion(supabase);

  const rows: unknown[][] = [
    [
      "Nombre",
      "Legajo",
      "Horas normales",
      "H. Extra 50%",
      "H. Extra 100%",
      "Franco comp.",
      "$ Hora normal",
      "$ Extra 50%",
      "$ Extra 100%",
      "$ Franco comp.",
      "$ Total",
    ],
  ];

  for (const empleado of empleados ?? []) {
    await recalcularEmpleadoPeriodo(supabase, empleado.id, fechaDesde, fechaHasta);
    const [{ data: dias }, { data: francos }] = await Promise.all([
      supabase
        .from("calculos_diarios")
        .select("horas_normales, horas_extra_50, horas_extra_100, extras_validadas")
        .eq("empleado_id", empleado.id)
        .gte("fecha", desde)
        .lte("fecha", hasta),
      supabase
        .from("francos")
        .select("horas")
        .eq("empleado_id", empleado.id)
        .gte("fecha_generado", desde)
        .lte("fecha_generado", hasta),
    ]);

    const horasNormales = (dias ?? []).reduce((a, d) => a + Number(d.horas_normales), 0);
    const diasValidados = (dias ?? []).filter((d) => d.extras_validadas);
    const horasExtra50 = diasValidados.reduce((a, d) => a + Number(d.horas_extra_50), 0);
    const horasExtra100 = diasValidados.reduce((a, d) => a + Number(d.horas_extra_100), 0);
    const horasFranco = (francos ?? []).reduce((a, f) => a + Number(f.horas), 0);

    const valorHora = Number(empleado.valor_hora_normal);
    const montoNormal = horasNormales * valorHora;
    const montoExtra50 = horasExtra50 * valorHora * config.multiplicadorExtra50;
    const montoExtra100 = horasExtra100 * valorHora * config.multiplicadorExtra100;
    const montoFranco = horasFranco * valorHora;
    const montoTotal = montoNormal + montoExtra50 + montoExtra100 + montoFranco;

    rows.push([
      `${empleado.apellido}, ${empleado.nombre}`,
      empleado.legajo,
      Math.round(horasNormales * 10) / 10,
      Math.round(horasExtra50 * 10) / 10,
      Math.round(horasExtra100 * 10) / 10,
      Math.round(horasFranco * 10) / 10,
      Math.round(montoNormal),
      Math.round(montoExtra50),
      Math.round(montoExtra100),
      Math.round(montoFranco),
      Math.round(montoTotal),
    ]);
  }

  return xlsxResponse(`planilla-general-${desde}-a-${hasta}.xlsx`, "Planilla general", rows);
}
