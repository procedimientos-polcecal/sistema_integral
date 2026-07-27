import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { xlsxResponse } from "@/lib/rrhh/xlsxExport";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const employeeId = url.searchParams.get("employeeId");
  const estado = url.searchParams.get("estado");

  let query = supabase
    .from("francos")
    .select("fecha_generado, horas, estado, fecha_tomado, empleados(legajo, nombre, apellido)")
    .order("fecha_generado", { ascending: false });
  if (employeeId) query = query.eq("empleado_id", employeeId);
  if (estado) query = query.eq("estado", estado);

  const { data } = await query;
  const rows = [
    ["Legajo", "Empleado", "Generado", "Horas", "Estado", "Tomado el"],
    ...(data ?? []).map((f: any) => [
      f.empleados?.legajo,
      `${f.empleados?.apellido}, ${f.empleados?.nombre}`,
      new Date(f.fecha_generado).toLocaleDateString("es-AR", { timeZone: "UTC" }),
      f.horas,
      f.estado,
      f.fecha_tomado ? new Date(f.fecha_tomado).toLocaleDateString("es-AR", { timeZone: "UTC" }) : "",
    ]),
  ];
  return xlsxResponse("francos.xlsx", "Francos", rows);
}
