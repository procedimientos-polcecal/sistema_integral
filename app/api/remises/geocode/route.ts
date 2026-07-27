import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/remises/route-utils";
import { geocode } from "@/lib/remises/engine/geocode";

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await request.json();
  const direccion = String(body.direccion ?? "").trim();
  if (!direccion) return NextResponse.json({ error: "Ingresá una dirección" }, { status: 400 });

  const { data: config } = await supabase.from("remises_config").select("ciudad_referencia, fabrica_lat, fabrica_lng").eq("id", 1).single();

  const resultado = await geocode(direccion, {
    ciudad: config?.ciudad_referencia,
    fabricaLat: config?.fabrica_lat != null ? Number(config.fabrica_lat) : null,
    fabricaLng: config?.fabrica_lng != null ? Number(config.fabrica_lng) : null,
  });
  if (!resultado) return NextResponse.json({ error: "No se encontró la dirección" }, { status: 404 });
  return NextResponse.json(resultado);
}
