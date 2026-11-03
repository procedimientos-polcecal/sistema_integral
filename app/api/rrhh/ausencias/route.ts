import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check, puede_editar_check } from "@/lib/rrhh/route-utils";
import { altaDeAusencia } from "@/lib/rrhh/altaDeAusencia";
import { cuerpoJson } from "@/lib/core/cuerpo";

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

  // El cuerpo vive en `lib/rrhh/altaDeAusencia.ts` porque lo comparte con la
  // punta de Mantenimiento: ahí adentro está el insert y, sobre todo, la
  // sincronización de vacaciones y el recálculo de la liquidación, que es lo
  // que no puede saltearse ninguna de las dos.
  const { ausencia, error, status } = await altaDeAusencia(supabase, {
    employeeId, fechaDesde, fechaHasta, tipo, justificada, observaciones,
    anioCorrespondiente, cargadoPorId: user!.id,
  });
  // Se mira el `status` y no si `error` tiene texto: un mensaje vacío de
  // Postgres haría caer un error adentro de un 201 con el cuerpo en undefined.
  // La punta de Mantenimiento ya estaba así; ésta es de donde salió aquélla y
  // había quedado sin el arreglo, que es la peor forma de tener un contrato
  // compartido: una mitad defendida y la otra no.
  if (status) return NextResponse.json({ error }, { status });
  return NextResponse.json(ausencia, { status: 201 });
}
