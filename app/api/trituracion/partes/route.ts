import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarTrituracion, tieneAccesoTrituracion } from "@/lib/trituracion/auth";
import { traerPartes } from "@/lib/trituracion/consultas";
import { espejarParte } from "@/lib/trituracion/espejo";
import { esEstadoValido, esMaterialValido } from "@/lib/trituracion/vocabulario";

/**
 * El parte de una planta, por día. Un `POST` con `(planta_id, fecha)` que ya
 * existe reemplaza ese parte (`unique(planta_id, fecha)` en la base) — no hay
 * un PATCH aparte, cargar el mismo día dos veces es corregirlo. Después
 * escribe (o reescribe) la fila correspondiente en `PLANTA {N}`, mismo
 * patrón que `lib/tallerVial/espejo.ts` y `lib/cantera/espejo.ts`.
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
    planta_id, fecha, estado, motivo_no_operativo, material, origen, hora_inicio, hora_fin,
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

  const { data, error } = await supabase
    .from("trituracion_partes")
    .upsert(
      {
        planta_id,
        fecha,
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
      { onConflict: "planta_id,fecha" }
    )
    .select("id, planta_id, fecha, estado, motivo_no_operativo, material, origen, hora_inicio, hora_fin, operario_id, operario_raw, horas_mantenimiento, horas_falta_piedra, horas_produccion, horas_otro, motivo_otro, camiones_llegados, toneladas_procesadas, observaciones, sheets_pendiente")
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
