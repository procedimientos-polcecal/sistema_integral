import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { empleadosPermitidos, idsOrDummy, periodoARango } from "@/lib/rrhh/dashboardHelpers";
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


  const calculos = await traerPaginado<{ empleado_id: string }>(
    () =>
      supabase
        .from("calculos_diarios")
        .select("empleado_id")
        .in("empleado_id", idsOrDummy(empleadoIds))
        .gte("fecha", desde.toISOString().slice(0, 10))
        .lte("fecha", hasta.toISOString().slice(0, 10))
        .eq("ausente", true)
        .order("id"),
    "top de ausencias"
  );

  const conteoPorEmpleado = new Map<string, number>();
  for (const c of calculos) {
    conteoPorEmpleado.set(c.empleado_id, (conteoPorEmpleado.get(c.empleado_id) ?? 0) + 1);
  }

  const top = empleados
    .map((e) => ({ employeeId: e.id, legajo: e.legajo, nombre: `${e.apellido}, ${e.nombre}`, ausencias: conteoPorEmpleado.get(e.id) ?? 0 }))
    .filter((e) => e.ausencias > 0)
    .sort((a, b) => b.ausencias - a.ausencias)
    .slice(0, 10);

  return NextResponse.json(top);
}
