import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/rrhh/route-utils";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const employeeId = url.searchParams.get("employeeId");

  let query = supabase
    .from("liquidaciones")
    .select("*, empleados(id, legajo, nombre, apellido)")
    .order("fecha_desde", { ascending: false });
  if (employeeId) query = query.eq("empleado_id", employeeId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
