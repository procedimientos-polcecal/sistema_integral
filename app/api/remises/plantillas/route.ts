import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check, puede_editar_check } from "@/lib/remises/route-utils";

export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { data, error } = await supabase
    .from("remises_plantillas")
    .select("*, remises_turnos(nombre), remises_plantillas_grupos(vehiculo_id, empleado_id, vehiculos(nombre), empleados(nombre, apellido))")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** Crea una plantilla a partir de las hojas de ruta indicadas (de Hoy o de Historial — misma operación). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await request.json();
  const { nombre, turnoId, hojaIds } = body;
  if (!nombre?.trim() || !turnoId || !hojaIds?.length) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const { data: hojas } = await supabase
    .from("hojas_ruta")
    .select("id, tipo, vehiculo_id, asientos(empleado_id)")
    .in("id", hojaIds);
  if (!hojas?.length) return NextResponse.json({ error: "No se encontraron las hojas de ruta origen" }, { status: 400 });

  const tipo = hojas[0].tipo;
  const { data: plantilla, error } = await supabase
    .from("remises_plantillas")
    .insert({ nombre: nombre.trim(), tipo, turno_id: turnoId })
    .select("id")
    .single();
  if (error || !plantilla) return NextResponse.json({ error: error?.message ?? "No se pudo crear la plantilla" }, { status: 500 });

  const grupos = hojas.flatMap((h: any) =>
    (h.asientos ?? []).map((a: any) => ({ plantilla_id: plantilla.id, vehiculo_id: h.vehiculo_id, empleado_id: a.empleado_id }))
  );
  if (grupos.length) await supabase.from("remises_plantillas_grupos").insert(grupos);

  return NextResponse.json({ id: plantilla.id }, { status: 201 });
}
