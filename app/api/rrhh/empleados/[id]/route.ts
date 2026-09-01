import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminRrhh } from "@/lib/rrhh/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: empleado, error } = await supabase
    .from("empleados")
    .select("*, empresas(id, nombre), sectores(id, nombre), rrhh_empleados_datos(sindicato, fecha_nacimiento, genero, escala_vacaciones_override)")
    .eq("id", id)
    .single();
  if (error || !empleado) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json(empleado);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminRrhh(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await cuerpoJson(request);
  const admin = createAdminClient();

  const empleadoData: Record<string, unknown> = {};
  if (body.nombre !== undefined) empleadoData.nombre = body.nombre;
  if (body.apellido !== undefined) empleadoData.apellido = body.apellido;
  if (body.fechaIngreso !== undefined) empleadoData.fecha_ingreso = body.fechaIngreso;
  if (body.valorHoraNormal !== undefined) empleadoData.valor_hora_normal = Number(body.valorHoraNormal);
  if (body.horasTeoricasDiarias !== undefined) empleadoData.horas_teoricas_diarias = Number(body.horasTeoricasDiarias);
  if (body.modalidadPago !== undefined) empleadoData.modalidad_pago = body.modalidadPago === "MENSUAL" ? "MENSUAL" : "JORNAL";
  if (body.empresaId !== undefined) empleadoData.empresa_id = body.empresaId;
  if (body.sectorId !== undefined) empleadoData.sector_id = body.sectorId || null;
  if (body.activo !== undefined) empleadoData.activo = body.activo;

  if (Object.keys(empleadoData).length > 0) {
    const { error } = await admin.from("empleados").update(empleadoData).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (body.sindicato !== undefined) {
    await admin.from("rrhh_empleados_datos").upsert(
      { empleado_id: id, sindicato: body.sindicato || null },
      { onConflict: "empleado_id" }
    );
  }

  const { data: empleado } = await admin.from("empleados").select("*").eq("id", id).single();
  return NextResponse.json(empleado);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminRrhh(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const admin = createAdminClient();
  const [fichadas, ausencias, vacaciones, francos, liquidaciones, calculos] = await Promise.all([
    admin.from("fichadas").select("id", { count: "exact", head: true }).eq("empleado_id", id),
    admin.from("ausencias").select("id", { count: "exact", head: true }).eq("empleado_id", id),
    admin.from("vacaciones").select("id", { count: "exact", head: true }).eq("empleado_id", id),
    admin.from("francos").select("id", { count: "exact", head: true }).eq("empleado_id", id),
    admin.from("liquidaciones").select("id", { count: "exact", head: true }).eq("empleado_id", id),
    admin.from("calculos_diarios").select("id", { count: "exact", head: true }).eq("empleado_id", id),
  ]);
  const tieneHistorial =
    (fichadas.count ?? 0) + (ausencias.count ?? 0) + (vacaciones.count ?? 0) +
    (francos.count ?? 0) + (liquidaciones.count ?? 0) + (calculos.count ?? 0) > 0;
  if (tieneHistorial) {
    return NextResponse.json(
      { error: "No se puede eliminar: el empleado tiene fichadas, ausencias, vacaciones u otros registros históricos. Dalo de baja (marcalo inactivo) para conservar el historial en su lugar." },
      { status: 409 }
    );
  }

  const { error } = await admin.from("empleados").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
