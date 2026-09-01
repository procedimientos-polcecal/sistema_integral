import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/remises/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const data: Record<string, unknown> = {};
  if (body.nombre !== undefined) {
    const nombre = String(body.nombre).trim();
    if (!nombre) return NextResponse.json({ error: "Ingresá el nombre del chofer" }, { status: 400 });
    data.nombre = nombre;
  }
  if (body.telefono !== undefined) data.telefono = body.telefono?.trim() || null;
  if (body.activo !== undefined) data.activo = body.activo;

  const { data: chofer, error } = await supabase.from("choferes").update(data).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(chofer);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  // choferes tiene "on delete set null" en vehiculos/hojas_ruta — no hace
  // falta chequeo previo de uso, borrar acá solo desvincula.
  const { error } = await supabase.from("choferes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
