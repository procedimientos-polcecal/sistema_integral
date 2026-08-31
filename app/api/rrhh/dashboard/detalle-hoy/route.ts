import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { empleadosPermitidos, idsOrDummy } from "@/lib/rrhh/dashboardHelpers";
import { utcDateOnlyFrom } from "@/lib/rrhh/dates";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const empresaId = url.searchParams.get("empresaId");
  const sectorId = url.searchParams.get("sectorId");
  const hoy = utcDateOnlyFrom(new Date());
  const hoyStr = hoy.toISOString().slice(0, 10);

  const empleados = await empleadosPermitidos(supabase, { empresaId, sectorId });
  const empleadoIds = empleados.map((e) => e.id);


  const [{ data: calculos }, { data: tardanzasManuales }, { data: vacaciones }] = await Promise.all([
    supabase.from("calculos_diarios").select("empleado_id, ausente, tarde").in("empleado_id", idsOrDummy(empleadoIds)).eq("fecha", hoyStr),
    supabase.from("ausencias").select("empleado_id").in("empleado_id", idsOrDummy(empleadoIds)).eq("tipo", "TARDANZA").lte("fecha_desde", hoyStr).gte("fecha_hasta", hoyStr),
    supabase.from("vacaciones").select("empleado_id").in("empleado_id", idsOrDummy(empleadoIds)).lte("fecha_desde", hoyStr).gte("fecha_hasta", hoyStr),
  ]);

  const calculoPorEmpleado = new Map((calculos ?? []).map((c) => [c.empleado_id, c]));
  const tardanzaManualIds = new Set((tardanzasManuales ?? []).map((a) => a.empleado_id));
  const vacacionIds = new Set((vacaciones ?? []).map((v) => v.empleado_id));

  const info = (e: (typeof empleados)[number]) => ({
    employeeId: e.id,
    legajo: e.legajo,
    nombre: `${e.apellido}, ${e.nombre}`,
    sector: e.sectores?.nombre ?? null,
  });

  return NextResponse.json({
    presentes: empleados.filter((e) => !calculoPorEmpleado.get(e.id)?.ausente).map(info),
    ausentes: empleados.filter((e) => calculoPorEmpleado.get(e.id)?.ausente).map(info),
    tardes: empleados.filter((e) => calculoPorEmpleado.get(e.id)?.tarde || tardanzaManualIds.has(e.id)).map(info),
    vacaciones: empleados.filter((e) => vacacionIds.has(e.id)).map(info),
  });
}
