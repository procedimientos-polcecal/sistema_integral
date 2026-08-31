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


  const [{ data: calculos }, { data: tardanzasManuales }, { count: vacacionesHoy }] = await Promise.all([
    supabase.from("calculos_diarios").select("empleado_id, ausente, tarde").in("empleado_id", idsOrDummy(empleadoIds)).eq("fecha", hoyStr),
    supabase.from("ausencias").select("empleado_id").in("empleado_id", idsOrDummy(empleadoIds)).eq("tipo", "TARDANZA").lte("fecha_desde", hoyStr).gte("fecha_hasta", hoyStr),
    supabase.from("vacaciones").select("id", { count: "exact", head: true }).in("empleado_id", idsOrDummy(empleadoIds)).lte("fecha_desde", hoyStr).gte("fecha_hasta", hoyStr),
  ]);

  const totalActivos = empleados.length;
  const ausentesHoy = (calculos ?? []).filter((c) => c.ausente).length;
  const presentesHoy = totalActivos - ausentesHoy;
  const tardesIds = new Set<string>([
    ...(calculos ?? []).filter((c) => c.tarde).map((c) => c.empleado_id),
    ...(tardanzasManuales ?? []).map((a) => a.empleado_id),
  ]);

  const pct = (n: number) => (totalActivos > 0 ? Math.round((n / totalActivos) * 1000) / 10 : 0);

  return NextResponse.json({
    totalActivos,
    presentes: { cantidad: presentesHoy, porcentaje: pct(presentesHoy) },
    ausentes: { cantidad: ausentesHoy, porcentaje: pct(ausentesHoy) },
    tardes: { cantidad: tardesIds.size, porcentaje: pct(tardesIds.size) },
    vacaciones: { cantidad: vacacionesHoy ?? 0, porcentaje: pct(vacacionesHoy ?? 0) },
  });
}
