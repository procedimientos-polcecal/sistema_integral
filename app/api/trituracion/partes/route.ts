import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarTrituracion, tieneAccesoTrituracion } from "@/lib/trituracion/auth";
import { traerPartes } from "@/lib/trituracion/consultas";
import { espejarParte } from "@/lib/trituracion/espejo";
import { esEstadoValido, esMaterialValido } from "@/lib/trituracion/vocabulario";

/**
 * El parte de una planta, por día y turno. Un `POST` con `(planta_id,
 * fecha, orden)` que ya existe reemplaza ese turno (`unique(planta_id,
 * fecha, orden)` en la base, migración 20260921094643) — no hay un PATCH
 * aparte, cargar el mismo turno dos veces es corregirlo. Sin `orden` en el
 * body es un turno NUEVO: se le asigna el siguiente número libre para esa
 * planta+fecha (1 si el día está vacío). Después escribe (o reescribe) la
 * fila correspondiente en `PLANTA {N}`, mismo patrón que
 * `lib/tallerVial/espejo.ts` y `lib/cantera/espejo.ts` — el espejo busca
 * por fecha, no por turno, así que con dos turnos el mismo día el segundo
 * guardado pisa en la planilla la fila que ya escribió el primero (ver la
 * migración para el detalle; no afecta a la base, sólo al espejo).
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoTrituracion(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Trituración" }, { status: 403 });
  }

  const url = new URL(request.url);
  const plantaId = url.searchParams.get("planta_id") ?? undefined;
  const desde = url.searchParams.get("desde") ?? undefined;
  const hasta = url.searchParams.get("hasta") ?? undefined;

  return NextResponse.json({ data: await traerPartes(supabase, { plantaId, desde, hasta }) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarTrituracion(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar en Trituración" }, { status: 403 });
  }

  const body = await request.json();
  const {
    planta_id, fecha, orden, estado, motivo_no_operativo, material, origen, hora_inicio, hora_fin,
    operario_id, operario_raw, horas_mantenimiento, horas_falta_piedra, horas_produccion, horas_otro,
    motivo_otro, camiones_llegados, toneladas_procesadas, observaciones,
  } = body;

  if (!planta_id || !fecha) {
    return NextResponse.json({ error: "Faltan datos: planta y fecha son obligatorios" }, { status: 400 });
  }
  if (estado !== undefined && !esEstadoValido(estado)) {
    return NextResponse.json({ error: `Estado inválido: ${estado}` }, { status: 400 });
  }
  if (material && !esMaterialValido(material)) {
    return NextResponse.json({ error: `Material inválido: ${material}` }, { status: 400 });
  }

  const { data: planta, error: errPlanta } = await supabase
    .from("trituracion_plantas")
    .select("id, codigo")
    .eq("id", planta_id)
    .maybeSingle();
  if (errPlanta) return NextResponse.json({ error: errPlanta.message }, { status: 400 });
  if (!planta) return NextResponse.json({ error: "Planta no encontrada" }, { status: 404 });

  // Sin `orden`: turno nuevo, se le asigna el siguiente número libre de ese
  // día (1 si no hay ninguno todavía).
  let ordenAGuardar = Number(orden);
  if (!orden || !isFinite(ordenAGuardar) || ordenAGuardar < 1) {
    const { data: existentes, error: errExistentes } = await supabase
      .from("trituracion_partes")
      .select("orden")
      .eq("planta_id", planta_id)
      .eq("fecha", fecha)
      .order("orden", { ascending: false })
      .limit(1);
    if (errExistentes) return NextResponse.json({ error: errExistentes.message }, { status: 400 });
    ordenAGuardar = (existentes?.[0]?.orden ?? 0) + 1;
  }

  const { data, error } = await supabase
    .from("trituracion_partes")
    .upsert(
      {
        planta_id,
        fecha,
        orden: ordenAGuardar,
        estado: estado ?? "opero",
        motivo_no_operativo: motivo_no_operativo || null,
        material: material || null,
        origen: origen || null,
        hora_inicio: hora_inicio || null,
        hora_fin: hora_fin || null,
        operario_id: operario_id || null,
        operario_raw: operario_raw || null,
        horas_mantenimiento: Number(horas_mantenimiento) || 0,
        horas_falta_piedra: Number(horas_falta_piedra) || 0,
        horas_produccion: Number(horas_produccion) || 0,
        horas_otro: Number(horas_otro) || 0,
        motivo_otro: motivo_otro || null,
        camiones_llegados: camiones_llegados === "" || camiones_llegados == null ? null : Number(camiones_llegados),
        toneladas_procesadas:
          toneladas_procesadas === "" || toneladas_procesadas == null ? null : Number(toneladas_procesadas),
        observaciones: observaciones || null,
        actualizado_por: user.id,
        actualizado_en: new Date().toISOString(),
      },
      { onConflict: "planta_id,fecha,orden" }
    )
    .select("id, planta_id, fecha, orden, estado, motivo_no_operativo, material, origen, hora_inicio, hora_fin, operario_id, operario_raw, horas_mantenimiento, horas_falta_piedra, horas_produccion, horas_otro, motivo_otro, camiones_llegados, toneladas_procesadas, observaciones, sheets_pendiente")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const resultado = await espejarParte(planta.codigo, {
    fecha: data.fecha,
    estado: data.estado,
    material: data.material,
    origen: data.origen,
    horaInicio: data.hora_inicio,
    horaFin: data.hora_fin,
    horasMantenimiento: data.horas_mantenimiento,
    horasFaltaPiedra: data.horas_falta_piedra,
    horasProduccion: data.horas_produccion,
    horasOtro: data.horas_otro,
    camionesLlegados: data.camiones_llegados,
    toneladasProcesadas: data.toneladas_procesadas,
    observaciones: data.observaciones,
  });

  let aviso: { tipo: string; mensaje: string } | null = null;
  if (!resultado.ok) {
    await supabase
      .from("trituracion_partes")
      .update({ sheets_pendiente: resultado.error, sheets_pendiente_en: new Date().toISOString() })
      .eq("id", data.id);
    aviso = { tipo: "SHEETS_PENDIENTE", mensaje: `Se guardó, pero no se pudo escribir en la planilla: ${resultado.error}` };
  } else if (data.sheets_pendiente) {
    await supabase.from("trituracion_partes").update({ sheets_pendiente: null, sheets_pendiente_en: null }).eq("id", data.id);
  }

  return NextResponse.json({ data, aviso });
}

/**
 * Borra un turno puntual — para cuando se agregó uno de más el mismo día.
 * No toca la planilla: el espejo sólo sabe reescribir por fecha, no vaciar
 * un turno específico (mismo límite que el guardado, ver el comentario de
 * arriba).
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarTrituracion(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para editar en Trituración" }, { status: 403 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el id del turno a borrar" }, { status: 400 });

  const { error } = await supabase.from("trituracion_partes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
