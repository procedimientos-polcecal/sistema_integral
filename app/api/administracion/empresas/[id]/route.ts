import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/core/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";

// Solo activo/inactivo: `empresas.nombre` tiene un check constraint que solo
// permite POLCECAL/POLYSAN, no se puede dar de alta una empresa nueva.
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  if (typeof body.activo !== "boolean") {
    return NextResponse.json({ error: "Falta el campo activo" }, { status: 400 });
  }

  const { data, error } = await supabase.from("empresas").update({ activo: body.activo }).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
