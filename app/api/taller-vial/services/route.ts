import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { tieneAccesoTallerVial, puedeEditarTallerVial } from "@/lib/tallerVial/auth";
import { traerServices } from "@/lib/tallerVial/consultas";
import { esTierDeServiceValido } from "@/lib/tallerVial/service";

/**
 * Los services por horómetro. A diferencia de las cargas de combustible y
 * los estados diarios, esto sí se carga desde la app — la planilla real no
 * tiene un registro cargable de cada intervención, sólo el estado calculado.
 */

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoTallerVial(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Taller Vial" }, { status: 403 });
  }

  const url = new URL(request.url);
  const equipoId = url.searchParams.get("equipo_id") ?? undefined;
  return NextResponse.json({ data: await traerServices(supabase, equipoId) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarTallerVial(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar un service" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  const equipoId = String(b?.equipo_id ?? "");
  if (!equipoId) return NextResponse.json({ error: "Falta el equipo" }, { status: 400 });
  const tier = Number(b?.tier);
  if (!esTierDeServiceValido(tier)) {
    return NextResponse.json({ error: "El escalón tiene que ser 250, 500, 1000 o 2000" }, { status: 400 });
  }
  if (typeof b?.fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) {
    return NextResponse.json({ error: "La fecha va como YYYY-MM-DD" }, { status: 400 });
  }
  const horometro = Number(b?.horometro);
  if (!isFinite(horometro) || horometro < 0) {
    return NextResponse.json({ error: "El horómetro tiene que ser un número" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("taller_vial_services")
    .insert({
      equipo_id: equipoId,
      tier,
      fecha: b.fecha,
      horometro,
      observaciones: typeof b?.observaciones === "string" ? b.observaciones.trim() || null : null,
      cargado_por: user.id,
    })
    .select("id, equipo_id, tier, fecha, horometro, observaciones, cargado_por, cargado_en")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
