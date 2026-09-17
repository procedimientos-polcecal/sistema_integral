import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { tieneAccesoTallerVial, puedeEditarTallerVial } from "@/lib/tallerVial/auth";
import { traerCargas } from "@/lib/tallerVial/consultas";

/**
 * Las cargas de combustible de Taller Vial. A diferencia de Cantera
 * (`/api/cantera/acarreos`), acá no hay upsert por (equipo, mes): un equipo
 * puede cargar varias veces el mismo día, así que cada `POST` es una fila
 * nueva, igual que la planilla real.
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
  const mes = url.searchParams.get("mes") ?? undefined;
  if (mes && !/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ error: "El mes va como YYYY-MM" }, { status: 400 });
  }

  return NextResponse.json({ data: await traerCargas(supabase, { equipoId, mes }) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarTallerVial(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar combustible" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  const equipoId = String(b?.equipo_id ?? "");
  if (!equipoId) return NextResponse.json({ error: "Falta el equipo" }, { status: 400 });
  const equipoRaw = typeof b?.equipo_raw === "string" ? b.equipo_raw.trim() : "";
  if (!equipoRaw) return NextResponse.json({ error: "Falta el nombre del equipo" }, { status: 400 });
  if (typeof b?.fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) {
    return NextResponse.json({ error: "La fecha va como YYYY-MM-DD" }, { status: 400 });
  }
  const litros = Number(b?.litros);
  if (!isFinite(litros) || litros <= 0) {
    return NextResponse.json({ error: "Los litros tienen que ser un número mayor a cero" }, { status: 400 });
  }
  const lectura = b?.lectura === null || b?.lectura === undefined || b?.lectura === "" ? null : Number(b.lectura);
  if (lectura !== null && (!isFinite(lectura) || lectura < 0)) {
    return NextResponse.json({ error: "La lectura tiene que ser un número" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("taller_vial_cargas")
    .insert({
      equipo_id: equipoId,
      equipo_raw: equipoRaw,
      fecha: b.fecha,
      litros,
      lectura,
      observaciones: typeof b?.observaciones === "string" ? b.observaciones.trim() || null : null,
      cargado_por: user.id,
    })
    .select("id, equipo_id, equipo_raw, fecha, litros, lectura, observaciones, cargado_por, cargado_en, actualizado_por, actualizado_en")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarTallerVial(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para borrar una carga" }, { status: 403 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });

  const { error } = await supabase.from("taller_vial_cargas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data: null });
}
