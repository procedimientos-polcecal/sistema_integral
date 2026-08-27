import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { empleadosPermitidos, idsOrDummy, rangoDesdeHasta, agruparPorSector } from "@/lib/rrhh/dashboardHelpers";
import { recalcularPeriodoCacheado } from "@/lib/rrhh/recalcCache";
import { SECTORES_LUNES_A_VIERNES } from "@/lib/rrhh/constants";
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

  await recalcularPeriodoCacheado(supabase, desde, hasta);

  // Una sola consulta para todos los sectores, agrupada despues en memoria.
  const todosLosIds = empleados.map((e) => e.id);
  const todos = await traerPaginado<{
    empleado_id: string;
    tipo_dia: string;
    horas_normales: number;
    horas_extra_50: number;
    horas_extra_100: number;
  }>(
    () =>
      supabase
        .from("calculos_diarios")
        .select("empleado_id, tipo_dia, horas_normales, horas_extra_50, horas_extra_100")
        .in("empleado_id", idsOrDummy(todosLosIds))
        .gte("fecha", desde.toISOString().slice(0, 10))
        .lte("fecha", hasta.toISOString().slice(0, 10))
        .order("id"),
    "horas por sector"
  );
  const calculosPorEmpleado = new Map<string, typeof todos>();
  for (const c of todos) {
    const arr = calculosPorEmpleado.get(c.empleado_id);
    if (arr) arr.push(c);
    else calculosPorEmpleado.set(c.empleado_id, [c]);
  }

  const resultado = [];
  for (const [sectorId, emps] of porSector) {
    const calculos = emps.flatMap((e) => calculosPorEmpleado.get(e.id) ?? []);

    const sectorNombre = emps[0].sectores?.nombre ?? "";
    const horasTrabajadas = calculos.reduce(
      (a, c) => a + Number(c.horas_normales) + Number(c.horas_extra_50) + Number(c.horas_extra_100),
      0
    );
    const diasEsperadosPorEmpleado = new Map<string, number>();
    for (const c of calculos) {
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
