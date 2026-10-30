import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { xlsxResponse } from "@/lib/core/xlsxExport";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const employeeId = url.searchParams.get("employeeId");
  const estado = url.searchParams.get("estado");
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");

  let query = supabase
    .from("francos")
    .select("fecha_generado, horas, estado, fecha_tomado, fecha_descanso, empleados(legajo, nombre, apellido)")
    .order("fecha_generado", { ascending: false });
  if (employeeId) query = query.eq("empleado_id", employeeId);
  if (estado) query = query.eq("estado", estado);
  if (desde) query = query.gte("fecha_generado", desde);
  if (hasta) query = query.lte("fecha_generado", hasta);

  const { data } = await query;
  const rows = [
    // "Marcado el" y no "Tomado el": es la fecha del tramite. El dia que la
    // persona descansa es la columna siguiente, y en los francos marcados antes
    // del 26/10/2026 esta vacia porque ese dato nunca se registro.
    ["Legajo", "Empleado", "Generado", "Horas", "Estado", "Marcado el", "Descansa el"],
    ...(data ?? []).map((f: any) => [
      f.empleados?.legajo,
      `${f.empleados?.apellido}, ${f.empleados?.nombre}`,
      new Date(f.fecha_generado).toLocaleDateString("es-AR", { timeZone: "UTC" }),
      f.horas,
      f.estado,
      f.fecha_tomado ? new Date(f.fecha_tomado).toLocaleDateString("es-AR", { timeZone: "UTC" }) : "",
      f.fecha_descanso ? new Date(f.fecha_descanso).toLocaleDateString("es-AR", { timeZone: "UTC" }) : "",
    ]),
  ];
  return await xlsxResponse("francos.xlsx", "Francos", rows);
}
