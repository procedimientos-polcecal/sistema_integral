import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarTallerVial, tieneAccesoTallerVial } from "@/lib/tallerVial/auth";
import { traerEstadosDiarios } from "@/lib/tallerVial/consultas";
import { codigoSheetDesdeEstado, esEstadoDiarioValido } from "@/lib/tallerVial/estados";
import { espejarEstado } from "@/lib/tallerVial/espejo";

/**
 * El estado diario de un equipo (Operativo / Fuera de servicio / Operativo
 * con fallas). Pivote del 18/09/2026: vuelve a cargarse desde acá — ver la
 * migración 20260918101859. El `POST` es un upsert por (equipo, fecha): un
 * equipo tiene un solo estado por día, así que cargar de nuevo el mismo día
 * corrige el anterior en vez de duplicarlo. También exporta hacia
 * "HISTORIAL ESTADOS" de la planilla real (`lib/tallerVial/espejo.ts`).
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

  return NextResponse.json({ data: await traerEstadosDiarios(supabase, { equipoId, mes }) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarTallerVial(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar en Taller Vial" }, { status: 403 });
  }

  const body = await request.json();
  const { equipo_id, fecha, estado, observaciones } = body;
  if (!equipo_id || !fecha) {
    return NextResponse.json({ error: "Faltan datos: equipo y fecha son obligatorios" }, { status: 400 });
  }
  if (!esEstadoDiarioValido(estado)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }

  const { data: equipo, error: errEquipo } = await supabase
    .from("equipos")
    .select("code")
    .eq("id", equipo_id)
    .maybeSingle();
  if (errEquipo) return NextResponse.json({ error: errEquipo.message }, { status: 400 });
  if (!equipo) return NextResponse.json({ error: "Equipo no encontrado" }, { status: 404 });

  const { data, error } = await supabase
    .from("taller_vial_estados_diarios")
    .upsert(
      { equipo_id, fecha, estado, observaciones: observaciones || null, cargado_por: user.id, sheets_pendiente: null },
      { onConflict: "equipo_id,fecha" }
    )
    .select("id, equipo_id, fecha, estado, observaciones, cargado_por, sheets_pendiente")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const resultado = await espejarEstado({ fecha, equipoCodigo: equipo.code, codigoSheet: codigoSheetDesdeEstado(estado) });
  let aviso: { tipo: string; mensaje: string } | null = null;
  if (!resultado.ok) {
    await supabase.from("taller_vial_estados_diarios").update({ sheets_pendiente: resultado.error }).eq("id", data.id);
    aviso = { tipo: "SHEETS_PENDIENTE", mensaje: `Se guardó, pero no se pudo escribir en la planilla: ${resultado.error}` };
  }

  return NextResponse.json({ data, aviso });
}
