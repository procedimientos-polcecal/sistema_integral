import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";

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
    .select("*, empleados(id, legajo, nombre, apellido)")
    .order("fecha_generado", { ascending: false });
  if (employeeId) query = query.eq("empleado_id", employeeId);
  if (estado) query = query.eq("estado", estado);
  if (desde) query = query.gte("fecha_generado", desde);
  if (hasta) query = query.lte("fecha_generado", hasta);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
