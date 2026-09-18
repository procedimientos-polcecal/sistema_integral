import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { esAdminTrituracion } from "@/lib/trituracion/auth";
import { traerPlantas } from "@/lib/trituracion/consultas";

/** El catálogo de plantas (hoy 3 filas). Sólo el admin del módulo lo edita. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return NextResponse.json({ data: await traerPlantas(supabase, false) });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminTrituracion(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso de admin en Trituración" }, { status: 403 });
  }

  const { id, nombre, activa } = await request.json();
  if (!id) return NextResponse.json({ error: "Falta el id de la planta" }, { status: 400 });

  const cambios: Record<string, unknown> = {};
  if (nombre !== undefined) cambios.nombre = nombre;
  if (activa !== undefined) cambios.activa = Boolean(activa);

  const { data, error } = await supabase
    .from("trituracion_plantas")
    .update(cambios)
    .eq("id", id)
    .select("id, codigo, nombre, activa, orden")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ data });
}
