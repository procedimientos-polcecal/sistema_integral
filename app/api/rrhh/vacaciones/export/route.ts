import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { xlsxResponse } from "@/lib/core/xlsxExport";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const employeeId = url.searchParams.get("employeeId");

  let query = supabase
    .from("vacaciones")
    .select("anio_correspondiente, fecha_desde, fecha_hasta, dias_tomados, observaciones, empleados(legajo, nombre, apellido)")
    .order("fecha_desde", { ascending: false });
  if (employeeId) query = query.eq("empleado_id", employeeId);

  const { data } = await query;
  const rows = [
    ["Legajo", "Empleado", "Año", "Desde", "Hasta", "Días tomados", "Observaciones"],
    ...(data ?? []).map((p: any) => [
      p.empleados?.legajo,
      `${p.empleados?.apellido}, ${p.empleados?.nombre}`,
      p.anio_correspondiente,
      new Date(p.fecha_desde).toLocaleDateString("es-AR", { timeZone: "UTC" }),
      new Date(p.fecha_hasta).toLocaleDateString("es-AR", { timeZone: "UTC" }),
      p.dias_tomados,
      p.observaciones ?? "",
    ]),
  ];
  return xlsxResponse("vacaciones.xlsx", "Vacaciones", rows);
}
