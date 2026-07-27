import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { empleadosPermitidos, idsOrDummy, periodoARango, agruparPorSector } from "@/lib/rrhh/dashboardHelpers";
import { recalcularPeriodoCacheado } from "@/lib/rrhh/recalcCache";
import { SECTORES_LUNES_A_VIERNES } from "@/lib/rrhh/constants";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const empresaId = url.searchParams.get("empresaId");
  const { desde, hasta } = periodoARango(url.searchParams.get("periodo"));

  const empleados = await empleadosPermitidos(supabase, { empresaId });
  const porSector = agruparPorSector(empleados);

  await recalcularPeriodoCacheado(supabase, desde, hasta);

  const resultado = [];
  for (const [sectorId, emps] of porSector) {
    const empleadoIds = emps.map((e) => e.id);
    const { data: calculos } = await supabase
      .from("calculos_diarios")
      .select("empleado_id, tipo_dia, horas_normales, horas_extra_50, horas_extra_100")
      .in("empleado_id", idsOrDummy(empleadoIds))
      .gte("fecha", desde.toISOString().slice(0, 10))
      .lte("fecha", hasta.toISOString().slice(0, 10));

    const sectorNombre = emps[0].sectores?.nombre ?? "";
    const horasTrabajadas = (calculos ?? []).reduce(
      (a, c) => a + Number(c.horas_normales) + Number(c.horas_extra_50) + Number(c.horas_extra_100),
      0
    );
    const diasEsperadosPorEmpleado = new Map<string, number>();
    for (const c of calculos ?? []) {
      if (c.tipo_dia !== "DOMINGO" && !(SECTORES_LUNES_A_VIERNES.includes(sectorNombre) && c.tipo_dia === "SABADO")) {
        diasEsperadosPorEmpleado.set(c.empleado_id, (diasEsperadosPorEmpleado.get(c.empleado_id) ?? 0) + 1);
      }
    }
    const horasTeoricas = emps.reduce((a, e) => a + (diasEsperadosPorEmpleado.get(e.id) ?? 0) * Number(e.horas_teoricas_diarias), 0);

    resultado.push({
      sectorId,
      sector: sectorNombre,
      horasTrabajadas: Math.round(horasTrabajadas * 10) / 10,
      horasTeoricas: Math.round(horasTeoricas * 10) / 10,
    });
  }

  return NextResponse.json(resultado);
}
