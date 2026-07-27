import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/remises/route-utils";

/**
 * Marca presentes a todos los empleados activos cuyo turno default coincide
 * con el turno elegido (no pisa asistencia ya marcada). En el original esto
 * pasaba automáticamente la primera vez que se abría un día+turno; acá es
 * una acción explícita para no depender de un estado implícito "¿ya se vio
 * esta fecha antes?" que no tiene un equivalente limpio en un modelo
 * relacional (una fila borrada y "nunca creada" son indistinguibles).
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await request.json();
  const { fecha, turnoId } = body;
  if (!fecha || !turnoId) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const { data: empleados } = await supabase
    .from("empleados")
    .select("id, remises_empleados_datos!inner(turno_default_id)")
    .eq("activo", true)
    .eq("remises_empleados_datos.turno_default_id", turnoId);

  const filas = (empleados ?? []).map((e) => ({ empleado_id: e.id, fecha, turno_id: turnoId }));
  if (filas.length > 0) {
    await supabase.from("remises_asistencia").upsert(filas, { onConflict: "empleado_id,fecha,turno_id", ignoreDuplicates: true });
  }
  return NextResponse.json({ marcados: filas.length });
}
