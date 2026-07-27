import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { xlsxResponse } from "@/lib/rrhh/xlsxExport";
import { formatHHMM } from "@/lib/rrhh/dates";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const employeeId = url.searchParams.get("employeeId");
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");

  let query = supabase
    .from("fichadas")
    .select("fecha, hora_entrada, hora_salida, origen, empleados(legajo, nombre, apellido)")
    .order("fecha", { ascending: false });
  if (employeeId) query = query.eq("empleado_id", employeeId);
  if (desde) query = query.gte("fecha", desde);
  if (hasta) query = query.lte("fecha", hasta);

  const { data } = await query;
  const rows = [
    ["Legajo", "Empleado", "Fecha", "Hora entrada", "Hora salida", "Origen"],
    ...(data ?? []).map((f: any) => [
      f.empleados?.legajo,
      `${f.empleados?.apellido}, ${f.empleados?.nombre}`,
      new Date(f.fecha).toLocaleDateString("es-AR", { timeZone: "UTC" }),
      formatHHMM(new Date(f.hora_entrada)),
      f.hora_salida ? formatHHMM(new Date(f.hora_salida)) : "",
      f.origen,
    ]),
  ];
  return xlsxResponse("fichadas.xlsx", "Fichadas", rows);
}
