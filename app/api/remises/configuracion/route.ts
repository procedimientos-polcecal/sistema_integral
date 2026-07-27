import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check, es_admin_check } from "@/lib/remises/route-utils";

function toApi(row: Record<string, unknown>) {
  return {
    fabricaNombre: row.fabrica_nombre,
    fabricaDireccion: row.fabrica_direccion,
    fabricaLat: row.fabrica_lat != null ? Number(row.fabrica_lat) : null,
    fabricaLng: row.fabrica_lng != null ? Number(row.fabrica_lng) : null,
    velocidadKmh: Number(row.velocidad_kmh),
    ciudadReferencia: row.ciudad_referencia,
  };
}

export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { data, error } = await supabase.from("remises_config").select("*").eq("id", 1).single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "No encontrada" }, { status: 500 });
  return NextResponse.json(toApi(data));
}

export async function PUT(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await request.json();
  const data: Record<string, unknown> = {};
  if (body.fabricaNombre !== undefined) data.fabrica_nombre = String(body.fabricaNombre).trim() || "Fábrica";
  if (body.fabricaDireccion !== undefined) data.fabrica_direccion = body.fabricaDireccion?.trim() || null;
  if (body.fabricaLat !== undefined) data.fabrica_lat = body.fabricaLat;
  if (body.fabricaLng !== undefined) data.fabrica_lng = body.fabricaLng;
  if (body.velocidadKmh !== undefined) {
    if (!(Number(body.velocidadKmh) > 0)) return NextResponse.json({ error: "velocidadKmh inválida" }, { status: 400 });
    data.velocidad_kmh = body.velocidadKmh;
  }
  if (body.ciudadReferencia !== undefined) data.ciudad_referencia = body.ciudadReferencia?.trim() || null;

  const { data: row, error } = await supabase.from("remises_config").update(data).eq("id", 1).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(toApi(row));
}
