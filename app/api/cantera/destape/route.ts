import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerDestape } from "@/lib/cantera/consultas";
import { esTipoDeCamionValido, esTipoDeRecursoValido } from "@/lib/cantera/destape";

/**
 * Un recurso (máquina propia + operario, o fletero + camión) usado un día
 * para destapar. No hay una clave natural para upsert —el mismo fletero
 * puede aparecer varias veces el mismo día con horarios distintos, como ya
 * pasa en la planilla real—, así que `POST` siempre inserta una fila nueva;
 * para corregir una ya cargada está `PATCH` (por `id`).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }

  const url = new URL(request.url);
  const desde = url.searchParams.get("desde") ?? undefined;
  const hasta = url.searchParams.get("hasta") ?? undefined;
  const yacimientoCodigo = url.searchParams.get("yacimiento") ?? undefined;

  return NextResponse.json({ data: await traerDestape(supabase, { desde, hasta, yacimientoCodigo }) });
}

const COLUMNAS =
  "id, fecha, yacimiento_codigo, frente, tipo_recurso, operario_id, fletero_id, recurso_raw, equipo_id, equipo_o_vehiculo_raw, tipo_camion, horas, viajes, observaciones, sheets_pendiente";

function validarCuerpo(b: Record<string, unknown>): string | null {
  if (typeof b.fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) return "La fecha va como YYYY-MM-DD";
  if (!esTipoDeRecursoValido(b.tipo_recurso)) return "Tipo de recurso inválido";
  if (!b.recurso_raw || typeof b.recurso_raw !== "string") return "Falta quién hizo el trabajo (operario o fletero)";
  if (!b.equipo_o_vehiculo_raw || typeof b.equipo_o_vehiculo_raw !== "string") return "Falta el equipo o vehículo";
  if (b.tipo_recurso === "fletero_externo" && b.tipo_camion && !esTipoDeCamionValido(b.tipo_camion)) {
    return "Tipo de camión inválido";
  }
  const horas = Number(b.horas);
  if (!isFinite(horas) || horas <= 0) return "Las horas tienen que ser un número mayor a cero";
  return null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar destape" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  const errorValidacion = validarCuerpo(b);
  if (errorValidacion) return NextResponse.json({ error: errorValidacion }, { status: 400 });

  const { data, error } = await supabase
    .from("cantera_destape")
    .insert({
      fecha: b.fecha,
      yacimiento_codigo: b.yacimiento_codigo || null,
      frente: b.frente || null,
      tipo_recurso: b.tipo_recurso,
      operario_id: b.operario_id || null,
      fletero_id: b.fletero_id || null,
      recurso_raw: b.recurso_raw,
      equipo_id: b.equipo_id || null,
      equipo_o_vehiculo_raw: b.equipo_o_vehiculo_raw,
      tipo_camion: b.tipo_recurso === "fletero_externo" ? (b.tipo_camion || null) : null,
      horas: Number(b.horas),
      viajes: b.viajes === "" || b.viajes == null ? null : Number(b.viajes),
      observaciones: b.observaciones || null,
      cargado_por: user.id,
    })
    .select(COLUMNAS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para editar destape" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  const id = String(b?.id ?? "");
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });
  const errorValidacion = validarCuerpo(b);
  if (errorValidacion) return NextResponse.json({ error: errorValidacion }, { status: 400 });

  const { data, error } = await supabase
    .from("cantera_destape")
    .update({
      fecha: b.fecha,
      yacimiento_codigo: b.yacimiento_codigo || null,
      frente: b.frente || null,
      tipo_recurso: b.tipo_recurso,
      operario_id: b.operario_id || null,
      fletero_id: b.fletero_id || null,
      recurso_raw: b.recurso_raw,
      equipo_id: b.equipo_id || null,
      equipo_o_vehiculo_raw: b.equipo_o_vehiculo_raw,
      tipo_camion: b.tipo_recurso === "fletero_externo" ? (b.tipo_camion || null) : null,
      horas: Number(b.horas),
      viajes: b.viajes === "" || b.viajes == null ? null : Number(b.viajes),
      observaciones: b.observaciones || null,
      actualizado_por: user.id,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", id)
    .select(COLUMNAS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para editar destape" }, { status: 403 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });

  const { error } = await supabase.from("cantera_destape").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
