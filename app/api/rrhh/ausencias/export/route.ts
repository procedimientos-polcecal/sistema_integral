import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { xlsxResponse } from "@/lib/core/xlsxExport";
import { labelTipoAusencia } from "@/lib/rrhh/tiposAusencia";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const employeeId = url.searchParams.get("employeeId");
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");

  let query = supabase
    .from("ausencias")
    .select("fecha_desde, fecha_hasta, tipo, justificada, observaciones, empleados(legajo, nombre, apellido), usuarios!ausencias_cargado_por_id_fkey(nombre)")
    .order("fecha_desde", { ascending: false });
  if (employeeId) query = query.eq("empleado_id", employeeId);
  if (hasta) query = query.lte("fecha_desde", hasta);
  if (desde) query = query.gte("fecha_hasta", desde);

  const { data } = await query;
  const rows = [
    ["Legajo", "Empleado", "Desde", "Hasta", "Tipo", "Justificada", "Observaciones", "Cargado por"],
    ...(data ?? []).map((a: any) => [
      a.empleados?.legajo,
      `${a.empleados?.apellido}, ${a.empleados?.nombre}`,
      new Date(a.fecha_desde).toLocaleDateString("es-AR", { timeZone: "UTC" }),
      new Date(a.fecha_hasta).toLocaleDateString("es-AR", { timeZone: "UTC" }),
      labelTipoAusencia(a.tipo),
      a.justificada ? "Sí" : "No",
      a.observaciones ?? "",
      a.usuarios?.nombre ?? "",
    ]),
  ];
  return xlsxResponse("ausencias.xlsx", "Ausencias", rows);
}
