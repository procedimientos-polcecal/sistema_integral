import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { empleadosPermitidos, idsOrDummy, periodoARango } from "@/lib/rrhh/dashboardHelpers";
import { recalcularPeriodoCacheado } from "@/lib/rrhh/recalcCache";
import { traerPaginado } from "@/lib/rrhh/paginado";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const empresaId = url.searchParams.get("empresaId");
  const sectorId = url.searchParams.get("sectorId");
  const { desde, hasta } = periodoARango(url.searchParams.get("periodo"));

  const empleados = await empleadosPermitidos(supabase, { empresaId, sectorId });
  const empleadoIds = empleados.map((e) => e.id);

  await recalcularPeriodoCacheado(supabase, desde, hasta);

  const calculos = await traerPaginado<{ empleado_id: string; tarde: boolean; retiro_anticipado: boolean }>(
    () =>
      supabase
        .from("calculos_diarios")
        .select("empleado_id, tarde, retiro_anticipado")
        .in("empleado_id", idsOrDummy(empleadoIds))
        .gte("fecha", desde.toISOString().slice(0, 10))
        .lte("fecha", hasta.toISOString().slice(0, 10))
        .or("tarde.eq.true,retiro_anticipado.eq.true")
        .order("id"),
    "top de tardanzas"
  );

  const conteoPorEmpleado = new Map<string, { tardanzas: number; retirosAnticipados: number }>();
  for (const c of calculos) {
    const actual = conteoPorEmpleado.get(c.empleado_id) ?? { tardanzas: 0, retirosAnticipados: 0 };
    if (c.tarde) actual.tardanzas += 1;
    if (c.retiro_anticipado) actual.retirosAnticipados += 1;
    conteoPorEmpleado.set(c.empleado_id, actual);
  }

  const top = empleados
    .map((e) => {
      const c = conteoPorEmpleado.get(e.id) ?? { tardanzas: 0, retirosAnticipados: 0 };
      return {
        employeeId: e.id,
        legajo: e.legajo,
        nombre: `${e.apellido}, ${e.nombre}`,
        tardanzas: c.tardanzas,
        retirosAnticipados: c.retirosAnticipados,
        total: c.tardanzas + c.retirosAnticipados,
      };
    })
    .filter((e) => e.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return NextResponse.json(top);
}
