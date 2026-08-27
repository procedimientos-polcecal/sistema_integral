import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { empleadosPermitidos, idsOrDummy, rangoDesdeHasta, agruparPorSector } from "@/lib/rrhh/dashboardHelpers";
import { recalcularPeriodoCacheado } from "@/lib/rrhh/recalcCache";
import { getConfigLiquidacion } from "@/lib/rrhh/engine/recalcular";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const empresaId = url.searchParams.get("empresaId");
  const { desde, hasta } = rangoDesdeHasta(url.searchParams);

  const empleados = await empleadosPermitidos(supabase, { empresaId });
  const porSector = agruparPorSector(empleados);
  const config = await getConfigLiquidacion(supabase);

  await recalcularPeriodoCacheado(supabase, desde, hasta);

  const resultado = [];
  for (const [sectorId, emps] of porSector) {
    const empleadoIds = emps.map((e) => e.id);
    const valorHoraPorEmpleado = new Map(emps.map((e) => [e.id, Number(e.valor_hora_normal)]));
    const { data: calculos } = await supabase
      .from("calculos_diarios")
      .select("empleado_id, horas_extra_50, horas_extra_100")
      .in("empleado_id", idsOrDummy(empleadoIds))
      .gte("fecha", desde.toISOString().slice(0, 10))
      .lte("fecha", hasta.toISOString().slice(0, 10));

    const extra50 = (calculos ?? []).reduce((a, c) => a + Number(c.horas_extra_50), 0);
    const extra100 = (calculos ?? []).reduce((a, c) => a + Number(c.horas_extra_100), 0);
    const montoExtra50 = (calculos ?? []).reduce(
      (a, c) => a + Number(c.horas_extra_50) * (valorHoraPorEmpleado.get(c.empleado_id) ?? 0) * config.multiplicadorExtra50,
      0
    );
    const montoExtra100 = (calculos ?? []).reduce(
      (a, c) => a + Number(c.horas_extra_100) * (valorHoraPorEmpleado.get(c.empleado_id) ?? 0) * config.multiplicadorExtra100,
      0
    );

    resultado.push({
      sectorId,
      sector: emps[0].sectores?.nombre ?? "",
      horasExtra50: Math.round(extra50 * 10) / 10,
      horasExtra100: Math.round(extra100 * 10) / 10,
      montoExtra50: Math.round(montoExtra50),
      montoExtra100: Math.round(montoExtra100),
    });
  }

  return NextResponse.json(resultado);
}
