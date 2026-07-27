import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check, es_admin_check } from "@/lib/rrhh/route-utils";

export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { data, error } = await supabase.from("feriados").select("*").order("fecha");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

const TIPOS = ["NACIONAL", "PROVINCIAL", "PUENTE"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await request.json();
  const { fecha, nombre, tipo } = body;
  if (!fecha || !nombre?.trim() || (tipo && !TIPOS.includes(tipo))) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("feriados")
    .insert({ fecha, nombre, ...(tipo ? { tipo } : {}) })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
