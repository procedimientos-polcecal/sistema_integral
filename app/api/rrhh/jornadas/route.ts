import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check, es_admin_check } from "@/lib/rrhh/route-utils";
import { recalcularVentanaEnSegundoPlano } from "@/lib/rrhh/recalculoProgramado";

export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { data, error } = await supabase.from("jornadas").select("*").order("nombre");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

const HORA_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await request.json();
  const { nombre, horaInicio, horaFin, toleranciaMinutos } = body;
  if (
    !nombre?.trim() ||
    !HORA_REGEX.test(horaInicio ?? "") ||
    !HORA_REGEX.test(horaFin ?? "") ||
    !Number.isInteger(toleranciaMinutos) ||
    toleranciaMinutos < 0 ||
    toleranciaMinutos > 120
  ) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("jornadas")
    .insert({ nombre, hora_inicio: horaInicio, hora_fin: horaFin, tolerancia_minutos: toleranciaMinutos })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Cambiar el catálogo de turnos cambia cómo se ajusta CADA fichada, así que
  // se recalcula la ventana. Va en segundo plano para no convertir un
  // "Guardar" de dos campos en una espera de varios segundos; si la función
  // se corta antes de terminar, la corrida de la madrugada lo arregla.
  recalcularVentanaEnSegundoPlano(supabase);
  return NextResponse.json(data, { status: 201 });
}
