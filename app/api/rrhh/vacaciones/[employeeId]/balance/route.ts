import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/rrhh/route-utils";
import { diasCorrespondientes, type TramoVacaciones } from "@/lib/rrhh/engine/vacaciones";

export async function GET(request: Request, { params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await params;
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const anio = url.searchParams.get("anio") ? Number(url.searchParams.get("anio")) : new Date().getFullYear();

  const { data: empleado } = await supabase
    .from("empleados")
    .select("fecha_ingreso, rrhh_empleados_datos(escala_vacaciones_override)")
    .eq("id", employeeId)
    .single();
  if (!empleado) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const { data: config } = await supabase.from("config_liquidacion").select("escala_vacaciones").eq("id", 1).single();
  const override = (empleado.rrhh_empleados_datos as unknown as { escala_vacaciones_override: TramoVacaciones[] | null } | null)
    ?.escala_vacaciones_override;
  const escala: TramoVacaciones[] = override ?? (config?.escala_vacaciones as TramoVacaciones[]) ?? [];

  const correspondientes = diasCorrespondientes(new Date(empleado.fecha_ingreso), anio, escala);
  const { data: periodos } = await supabase
    .from("vacaciones")
    .select("*")
    .eq("empleado_id", employeeId)
    .eq("anio_correspondiente", anio)
    .order("fecha_desde", { ascending: true });
  const tomados = (periodos ?? []).reduce((acc, p) => acc + p.dias_tomados, 0);

  return NextResponse.json({ anio, correspondientes, tomados, restantes: correspondientes - tomados, periodos: periodos ?? [] });
}
