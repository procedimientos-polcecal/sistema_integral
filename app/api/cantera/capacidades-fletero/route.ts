import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerCapacidadesFletero } from "@/lib/cantera/consultas";
import { esTipoDeCamionValido } from "@/lib/cantera/destape";

/**
 * Toneladas por viaje de un fletero con un tipo de camión — pestaña
 * "Capacidades" de destape. `GET` con acceso al módulo; alta/edición sólo
 * el admin. Upsert por (fletero_id, tipo_camion): cargar de nuevo corrige,
 * no duplica.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }
  return NextResponse.json({ data: await traerCapacidadesFletero(supabase) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sólo un admin de Cantera edita las capacidades" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  const fleteroId = String(b?.fletero_id ?? "");
  if (!fleteroId) return NextResponse.json({ error: "Falta el fletero" }, { status: 400 });
  if (!esTipoDeCamionValido(b?.tipo_camion)) {
    return NextResponse.json({ error: "Tipo de camión inválido" }, { status: 400 });
  }
  const toneladas = Number(b?.toneladas_por_viaje);
  if (!isFinite(toneladas) || toneladas < 0) {
    return NextResponse.json({ error: "Las toneladas por viaje tienen que ser un número" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("cantera_capacidades_fletero")
    .upsert(
      { fletero_id: fleteroId, tipo_camion: b.tipo_camion, toneladas_por_viaje: toneladas },
      { onConflict: "fletero_id,tipo_camion" }
    )
    .select("id, fletero_id, tipo_camion, toneladas_por_viaje")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
