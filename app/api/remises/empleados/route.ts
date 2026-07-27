import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/remises/route-utils";

export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { data, error } = await supabase
    .from("empleados")
    .select(
      "id, legajo, nombre, apellido, domicilio, activo, remises_empleados_datos(direccion, lat, lng, turno_default_id)"
    )
    .eq("activo", true)
    .order("apellido")
    .order("nombre");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
