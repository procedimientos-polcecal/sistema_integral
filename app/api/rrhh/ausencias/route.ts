import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check, puede_editar_check } from "@/lib/rrhh/route-utils";
import { recalcularEmpleadoPeriodo } from "@/lib/rrhh/engine/recalcular";
import { sincronizarPeriodoVacaciones } from "@/lib/rrhh/vacacionesDeAusencia";
import { cuerpoJson } from "@/lib/core/cuerpo";

const TIPOS = [
  "LICENCIA_ART", "VACACIONES", "LICENCIA_GREMIAL", "PERMISO_PERSONAL",
  "ENFERMEDAD_ACCIDENTE_INCULPABLE", "LICENCIA_SIN_GOCE_SUELDO", "SUSPENSION",
  "FALLECIMIENTO_FAMILIAR", "EXAMEN_ESTUDIO", "TARDANZA", "INJUSTIFICADA", "OTRA",
];

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const employeeId = url.searchParams.get("employeeId");
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");
  const justificada = url.searchParams.get("justificada");
  const excluirTipo = url.searchParams.get("excluirTipo");

  let query = supabase
    .from("ausencias")
    .select(
      "*, empleados(id, legajo, nombre, apellido), usuarios!ausencias_cargado_por_id_fkey(nombre), vacaciones!vacaciones_ausencia_id_fkey(anio_correspondiente)"
    )
    .order("fecha_desde", { ascending: false });
  if (employeeId) query = query.eq("empleado_id", employeeId);
  if (hasta) query = query.lte("fecha_desde", hasta);
  if (desde) query = query.gte("fecha_hasta", desde);
  if (justificada === "true") query = query.eq("justificada", true);
  if (justificada === "false") query = query.eq("justificada", false);
  if (excluirTipo) query = query.neq("tipo", excluirTipo);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;
  const { data: { user } } = await supabase.auth.getUser();

  const body = await cuerpoJson(request);
  const { employeeId, fechaDesde, fechaHasta, tipo, justificada, observaciones, anioCorrespondiente } = body;
  if (!employeeId || !fechaDesde || !fechaHasta || !TIPOS.includes(tipo) || typeof justificada !== "boolean") {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  if (tipo === "OTRA" && !(observaciones ?? "").trim()) {
    return NextResponse.json({ error: "Para el tipo 'Otra' hay que aclarar el motivo en observaciones" }, { status: 400 });
  }
  if (tipo === "VACACIONES" && justificada && !Number.isInteger(anioCorrespondiente)) {
    return NextResponse.json({ error: "Para Vacaciones hay que indicar a qué año corresponden los días" }, { status: 400 });
  }

  const { data: ausencia, error } = await supabase
    .from("ausencias")
    .insert({
      empleado_id: employeeId,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      tipo,
      justificada,
      observaciones: observaciones || null,
      cargado_por_id: user!.id,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sincronizarPeriodoVacaciones(supabase, ausencia, anioCorrespondiente);
  await recalcularEmpleadoPeriodo(supabase, employeeId, new Date(fechaDesde), new Date(fechaHasta));
  return NextResponse.json(ausencia, { status: 201 });
}
