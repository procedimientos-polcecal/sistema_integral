import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/rrhh/route-utils";
import { recalcularDia } from "@/lib/rrhh/recalculoProgramado";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  // Se lee antes de borrar: después ya no hay de qué fecha era.
  const { data: feriado } = await supabase.from("feriados").select("fecha").eq("id", id).maybeSingle();
  const { error } = await supabase.from("feriados").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Al dejar de ser feriado, ese día vuelve a contar como hábil para todos.
  if (feriado?.fecha) await recalcularDia(supabase, feriado.fecha);
  return new NextResponse(null, { status: 204 });
}
