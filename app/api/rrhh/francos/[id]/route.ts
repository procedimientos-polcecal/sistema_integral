import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/rrhh/route-utils";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const { estado, fechaTomado } = await request.json();
  if (estado !== "PENDIENTE" && estado !== "TOMADO") {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("francos")
    .update({ estado, ...(fechaTomado !== undefined ? { fecha_tomado: fechaTomado } : {}) })
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const { error } = await supabase.from("francos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
