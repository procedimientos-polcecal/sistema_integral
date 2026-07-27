import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/remises/route-utils";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await request.json();
  const data: Record<string, unknown> = { empleado_id: id };
  if (body.direccion !== undefined) data.direccion = body.direccion?.trim() || null;
  if (body.lat !== undefined) data.lat = body.lat;
  if (body.lng !== undefined) data.lng = body.lng;
  if (body.turnoDefaultId !== undefined) data.turno_default_id = body.turnoDefaultId || null;

  const { data: fila, error } = await supabase
    .from("remises_empleados_datos")
    .upsert(data, { onConflict: "empleado_id" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(fila);
}
