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
    if (!nombre) return NextResponse.json({ error: "Ingresá el nombre del vehículo" }, { status: 400 });
    data.nombre = nombre;
  }
  if (body.capacidad !== undefined) data.capacidad = Number(body.capacidad) || 8;
  if (body.choferId !== undefined) data.chofer_id = body.choferId || null;
  if (body.activo !== undefined) data.activo = body.activo;

  const { data: vehiculo, error } = await supabase
    .from("vehiculos")
    .update(data)
    .eq("id", id)
    .select("*, choferes(id, nombre, telefono)")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(vehiculo);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const { count } = await supabase
    .from("hojas_ruta")
    .select("id", { count: "exact", head: true })
    .eq("vehiculo_id", id);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: "No se puede eliminar: el vehículo tiene hojas de ruta generadas. Desactivalo en vez de eliminarlo." },
      { status: 400 }
    );
  }

  const { error } = await supabase.from("vehiculos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
