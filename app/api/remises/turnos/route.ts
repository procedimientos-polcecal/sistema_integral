import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check, es_admin_check } from "@/lib/remises/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";

export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { data, error } = await supabase.from("remises_turnos").select("*").order("nombre");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

const HORA_REGEX = /^\d{2}:\d{2}$/;

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const nombre = String(body.nombre ?? "").trim();
  if (!nombre || !HORA_REGEX.test(body.horaInicio ?? "") || !HORA_REGEX.test(body.horaFin ?? "")) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("remises_turnos")
    .insert({ nombre, hora_inicio: body.horaInicio, hora_fin: body.horaFin, color: body.color || "#2563eb" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
