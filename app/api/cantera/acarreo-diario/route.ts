import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerAcarreoDiario } from "@/lib/cantera/consultas";
import { esTipoDeAcarreoValido } from "@/lib/cantera/acarreo";

/**
 * El acarreo de un día puntual (hoy sólo se usa para "viaje de bloques",
 * pero cualquier tipo sin pesada vale) — `cantera_acarreo_diario`, aparte
 * del total mensual de `cantera_acarreos` que sigue calculando el pago al
 * fletero (ver la migración 20260921091013). Existe para que otro módulo
 * (Trituración) pueda mostrar cuánto llegó un día dado.
 *
 * `GET` filtra por tipo y/o rango de fechas. `PATCH` es un upsert por
 * tipo+fecha (`unique (tipo, fecha)` en la base); cantidad en cero borra el
 * renglón, mismo criterio que `/api/cantera/acarreos`.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }

  const url = new URL(request.url);
  const tipo = url.searchParams.get("tipo") ?? undefined;
  const desde = url.searchParams.get("desde") ?? undefined;
  const hasta = url.searchParams.get("hasta") ?? undefined;

  return NextResponse.json({ data: await traerAcarreoDiario(supabase, { tipo, desde, hasta }) });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar acarreo" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  if (!esTipoDeAcarreoValido(b?.tipo)) {
    return NextResponse.json({ error: "Tipo de acarreo inválido" }, { status: 400 });
  }
  if (typeof b?.fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.fecha)) {
    return NextResponse.json({ error: "La fecha va como YYYY-MM-DD" }, { status: 400 });
  }
  const cantidad = Number(b?.cantidad);
  if (!isFinite(cantidad) || cantidad < 0) {
    return NextResponse.json({ error: "La cantidad tiene que ser un número" }, { status: 400 });
  }

  // Cero = "no hubo nada de esto ese día": se borra el renglón en vez de
  // guardar un 0 que después hay que distinguir de "no se cargó todavía".
  if (cantidad === 0) {
    const { error } = await supabase
      .from("cantera_acarreo_diario")
      .delete()
      .eq("tipo", b.tipo)
      .eq("fecha", b.fecha);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data: null });
  }

  const { data, error } = await supabase
    .from("cantera_acarreo_diario")
    .upsert(
      {
        tipo: b.tipo,
        fecha: b.fecha,
        cantidad,
        observaciones: typeof b?.observaciones === "string" ? b.observaciones.trim() || null : null,
        actualizado_por: user.id,
        actualizado_en: new Date().toISOString(),
        cargado_por: user.id,
      },
      { onConflict: "tipo,fecha" }
    )
    .select("id, tipo, fecha, cantidad, observaciones, cargado_por, cargado_en, actualizado_por, actualizado_en")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
