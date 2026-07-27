import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";

export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { data: empleados } = await supabase
    .from("empleados")
    .select("id, rrhh_empleados_datos(genero)")
    .eq("activo", true);

  const conteo = new Map<string, number>();
  for (const e of empleados ?? []) {
    const genero = (e.rrhh_empleados_datos as unknown as { genero: string | null } | null)?.genero;
    const clave = genero?.trim() || "Sin especificar";
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  }

  return NextResponse.json([...conteo.entries()].map(([genero, cantidad]) => ({ genero, cantidad })));
}
