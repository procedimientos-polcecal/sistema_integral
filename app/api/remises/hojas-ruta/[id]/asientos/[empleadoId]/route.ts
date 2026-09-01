import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/remises/route-utils";
import { refrescarGeometriaHoja } from "@/lib/remises/refrescarGeometria";
import { cuerpoJson } from "@/lib/core/cuerpo";

/** Quita un empleado de esta hoja de ruta. */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; empleadoId: string }> }) {
  const { id, empleadoId } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const { error } = await supabase.from("asientos").delete().eq("hoja_ruta_id", id).eq("empleado_id", empleadoId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await refrescarGeometriaHoja(supabase, id);
  return NextResponse.json({ ok: true });
}

/** Mueve un empleado de esta hoja a otra (body: { destinoHojaId }). Refresca la geometría de ambas. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; empleadoId: string }> }) {
  const { id, empleadoId } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const destinoHojaId = body.destinoHojaId;
  if (!destinoHojaId) return NextResponse.json({ error: "Falta destinoHojaId" }, { status: 400 });

  await supabase.from("asientos").delete().eq("hoja_ruta_id", id).eq("empleado_id", empleadoId);
  const { count } = await supabase.from("asientos").select("id", { count: "exact", head: true }).eq("hoja_ruta_id", destinoHojaId);
  const { error } = await supabase
    .from("asientos")
    .insert({ hoja_ruta_id: destinoHojaId, empleado_id: empleadoId, orden: count ?? 0 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await Promise.all([refrescarGeometriaHoja(supabase, id), refrescarGeometriaHoja(supabase, destinoHojaId)]);
  return NextResponse.json({ ok: true });
}
