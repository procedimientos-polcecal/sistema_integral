import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";

export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { data: empleados } = await supabase
    .from("empleados")
    .select("id, empresas(nombre)")
    .eq("activo", true);

  const conteo = new Map<string, number>();
  for (const e of empleados ?? []) {
    const clave = (e.empresas as unknown as { nombre: string } | null)?.nombre ?? "Sin empresa";
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  }

  return NextResponse.json([...conteo.entries()].map(([empresa, cantidad]) => ({ empresa, cantidad })));
}
