import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { empleadosPermitidos, idsOrDummy, rangoDesdeHasta, agruparPorSector } from "@/lib/rrhh/dashboardHelpers";
import { getConfigLiquidacion } from "@/lib/rrhh/engine/recalcular";
import { traerPaginado } from "@/lib/rrhh/paginado";

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


  // Una sola consulta para todos los sectores y despues se agrupa en memoria:
  // una por sector eran ~15 idas y vueltas para pintar un grafico.
  const todosLosIds = empleados.map((e) => e.id);
  const calculos = await traerPaginado<{ empleado_id: string; horas_extra_50: number; horas_extra_100: number }>(
    () =>
      supabase
        .from("calculos_diarios")
        .select("empleado_id, horas_extra_50, horas_extra_100")
        .in("empleado_id", idsOrDummy(todosLosIds))
        .gte("fecha", desde.toISOString().slice(0, 10))
        .lte("fecha", hasta.toISOString().slice(0, 10))
        .order("id"),
    "horas extra por sector"
  );
  const calculosPorEmpleado = new Map<string, typeof calculos>();
  for (const c of calculos) {
    const arr = calculosPorEmpleado.get(c.empleado_id);
    if (arr) arr.push(c);
    else calculosPorEmpleado.set(c.empleado_id, [c]);
  }

  const resultado = [];
  for (const [sectorId, emps] of porSector) {
    let extra50 = 0;
    let extra100 = 0;
    let montoExtra50 = 0;
    let montoExtra100 = 0;
    for (const e of emps) {
      const valorHora = Number(e.valor_hora_normal);
      for (const c of calculosPorEmpleado.get(e.id) ?? []) {
        extra50 += Number(c.horas_extra_50);
        extra100 += Number(c.horas_extra_100);
        montoExtra50 += Number(c.horas_extra_50) * valorHora * config.multiplicadorExtra50;
        montoExtra100 += Number(c.horas_extra_100) * valorHora * config.multiplicadorExtra100;
      }
    }

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
