import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/rrhh/route-utils";
import { auditar, nombreParaAuditoria } from "@/lib/core/auditoria";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const { data, error } = await supabase
    .from("liquidaciones")
    .update({ estado: "CERRADA" })
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Quién la cerró. No había reapertura escrita en ningún lado, así que esto
  // era un estado terminal sin autor. Ver `lib/core/auditoria.ts`.
  const { data: { user } } = await supabase.auth.getUser();
  const { data: quien } = user
    ? await supabase.from("usuarios").select("nombre, apellido, email").eq("id", user.id).maybeSingle()
    : { data: null };

  const registro = await auditar(supabase, {
    modulo: "rrhh",
    entidad: "liquidaciones",
    entidadId: id,
    accion: "cerrar",
    usuario: user ? { id: user.id, nombre: nombreParaAuditoria(quien) } : null,
    valorNuevo: "CERRADA",
    contexto: {
      empleado_id: data?.empleado_id ?? null,
      periodo: [data?.fecha_desde ?? null, data?.fecha_hasta ?? null],
      total_bruto: data?.total_bruto ?? null,
    },
  });

  return NextResponse.json({ ...data, auditoria_error: registro.ok ? null : registro.error });
}
