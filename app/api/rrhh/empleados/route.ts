import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminRrhh } from "@/lib/rrhh/auth";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await esAdminRrhh(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await request.json();
  const { legajo, nombre, apellido, sindicato, fechaIngreso, valorHoraNormal, horasTeoricasDiarias, modalidadPago, empresaId, sectorId } = body;

  if (!legajo?.trim() || !nombre?.trim() || !apellido?.trim() || !fechaIngreso || !empresaId) {
    return NextResponse.json({ error: "Faltan campos obligatorios" }, { status: 400 });
  }
  if (!(Number(valorHoraNormal) > 0)) {
    return NextResponse.json({ error: "Valor hora normal inválido" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: empleado, error } = await admin
    .from("empleados")
    .insert({
      legajo: legajo.trim(),
      nombre: nombre.trim(),
      apellido: apellido.trim(),
      fecha_ingreso: fechaIngreso,
      valor_hora_normal: Number(valorHoraNormal),
      horas_teoricas_diarias: horasTeoricasDiarias ? Number(horasTeoricasDiarias) : 8,
      modalidad_pago: modalidadPago === "MENSUAL" ? "MENSUAL" : "JORNAL",
      empresa_id: empresaId,
      sector_id: sectorId || null,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (sindicato) {
    await admin.from("rrhh_empleados_datos").insert({ empleado_id: empleado.id, sindicato });
  }

  return NextResponse.json({ data: empleado }, { status: 201 });
}
