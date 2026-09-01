import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";

// GET — listar planes
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? 20);
  const { data, error } = await supabase
    .from("planificacion_diaria")
    .select("*, created_by_user:created_by(nombre, apellido), planificacion_diaria_items(id)")
    .order("fecha", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// POST — crear plan
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { fecha, titulo, notas } = await cuerpoJson(request);
  if (!fecha) return NextResponse.json({ error: "Fecha requerida" }, { status: 400 });

  const { data, error } = await supabase
    .from("planificacion_diaria")
    .insert({ fecha, titulo: titulo?.trim() || null, notas: notas?.trim() || null, created_by: user.id })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
