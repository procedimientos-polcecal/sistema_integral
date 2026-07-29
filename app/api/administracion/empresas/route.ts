import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/core/route-utils";

export async function GET() {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const { data, error } = await supabase
    .from("empresas")
    .select("id, nombre, activo, sectores(id, nombre, activo)")
    .order("nombre");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
