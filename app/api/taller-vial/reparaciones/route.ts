import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { tieneAccesoTallerVial, puedeEditarTallerVial } from "@/lib/tallerVial/auth";
import { traerReparaciones } from "@/lib/tallerVial/consultas";

/**
 * El historial de reparaciones de los equipos móviles: se carga desde acá,
 * no espeja ninguna planilla (mismo criterio que los services por
 * horómetro).
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
  return NextResponse.json({ data: await traerReparaciones(supabase, equipoId) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarTallerVial(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar una reparación" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  const equipoId = String(b?.equipo_id ?? "");
  if (!equipoId) return NextResponse.json({ error: "Falta el equipo" }, { status: 400 });
  if (typeof b?.fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) {
    return NextResponse.json({ error: "La fecha va como YYYY-MM-DD" }, { status: 400 });
  }
  const descripcion = typeof b?.descripcion === "string" ? b.descripcion.trim() : "";
  if (!descripcion) return NextResponse.json({ error: "Falta la descripción de la reparación" }, { status: 400 });

  const horas = b?.horas === null || b?.horas === undefined || b?.horas === "" ? null : Number(b.horas);
  if (horas !== null && (!isFinite(horas) || horas < 0)) {
    return NextResponse.json({ error: "Las horas tienen que ser un número" }, { status: 400 });
  }
  const horometro = b?.horometro === null || b?.horometro === undefined || b?.horometro === "" ? null : Number(b.horometro);
  if (horometro !== null && (!isFinite(horometro) || horometro < 0)) {
    return NextResponse.json({ error: "El horómetro tiene que ser un número" }, { status: 400 });
  }

  const tipo = typeof b?.tipo === "string" && b.tipo.trim() ? b.tipo.trim() : "Reparación";

  const { data, error } = await supabase
    .from("taller_vial_reparaciones")
    .insert({
      equipo_id: equipoId,
      tipo,
      fecha: b.fecha,
      descripcion,
      horas,
      horometro,
      observaciones: typeof b?.observaciones === "string" ? b.observaciones.trim() || null : null,
      cargado_por: user.id,
    })
    .select("id, equipo_id, tipo, fecha, descripcion, horas, horometro, observaciones, cargado_por, cargado_en")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

/**
 * Borrar una reparación se lleva puestas sus reservas de repuestos (`on
 * delete cascade`) — mismo motivo que en /api/taller-vial/services: reservar
 * nunca descontó stock, así que no hay nada que devolver.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarTallerVial(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para borrar una reparación" }, { status: 403 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });

  const { error } = await supabase.from("taller_vial_reparaciones").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data: null });
}
