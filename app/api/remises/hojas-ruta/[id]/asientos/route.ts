import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/remises/route-utils";
import { refrescarGeometriaHoja } from "@/lib/remises/refrescarGeometria";

/** Agrega un empleado al final de esta hoja de ruta. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await request.json();
  const empleadoId = body.empleadoId;
  if (!empleadoId) return NextResponse.json({ error: "Falta empleadoId" }, { status: 400 });

  const { count } = await supabase.from("asientos").select("id", { count: "exact", head: true }).eq("hoja_ruta_id", id);
  const { error } = await supabase.from("asientos").insert({ hoja_ruta_id: id, empleado_id: empleadoId, orden: count ?? 0 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await refrescarGeometriaHoja(supabase, id);
  return NextResponse.json({ ok: true }, { status: 201 });
}

/** Reordena los asientos de esta hoja según el array de empleadoIds recibido. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await request.json();
  const orden: string[] = body.empleadoIds ?? [];
  if (!Array.isArray(orden) || !orden.length) return NextResponse.json({ error: "Falta empleadoIds" }, { status: 400 });

  await Promise.all(
    orden.map((empleadoId, i) =>
      supabase.from("asientos").update({ orden: i }).eq("hoja_ruta_id", id).eq("empleado_id", empleadoId)
    )
  );

  await refrescarGeometriaHoja(supabase, id);
  return NextResponse.json({ ok: true });
}
