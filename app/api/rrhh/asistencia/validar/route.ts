import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { es_admin_check } from "@/lib/rrhh/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";

export async function PUT(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;
  const { data: { user } } = await supabase.auth.getUser();

  const { employeeId, fecha } = await cuerpoJson(request);
  if (!employeeId || !fecha) return NextResponse.json({ error: "Faltan datos" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("calculos_diarios")
    .update({ extras_validadas: true, validado_por_id: user!.id, fecha_validacion: new Date().toISOString() })
    .eq("empleado_id", employeeId)
    .eq("fecha", fecha)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
