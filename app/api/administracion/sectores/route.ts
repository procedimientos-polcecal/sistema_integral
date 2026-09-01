import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/core/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const nombre = String(body.nombre ?? "").trim();
  const empresaId = body.empresaId;
  if (!nombre || !empresaId) {
    return NextResponse.json({ error: "Completá el nombre y la empresa" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("sectores")
    .insert({ nombre, empresa_id: empresaId })
    .select()
    .single();
  if (error) {
    const msg = error.code === "23505" ? "Ya existe un sector con ese nombre en esa empresa" : error.message;
    return NextResponse.json({ error: msg }, { status: error.code === "23505" ? 409 : 500 });
  }
  return NextResponse.json(data);
}
