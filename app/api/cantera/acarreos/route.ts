import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerAcarreos } from "@/lib/cantera/consultas";
import { esTipoDeAcarreoValido } from "@/lib/cantera/acarreo";

/**
 * El acarreo de un fletero: un renglón por tipo y **día** — el usuario pidió
 * explícitamente poder asignarle fecha a cada una de las 5 actividades sin
 * pesada (antes era un total por mes; ver la migración 20260921092307).
 *
 * `GET` filtra por fletero, tipo y/o mes. `PATCH` es un upsert por
 * fletero+tipo+**fecha** (`unique (fletero_id, tipo, fecha)` en la base):
 * cargar de nuevo el mismo día corrige ese renglón, no lo duplica — el total
 * del mes sale de sumar los días (`resumenPorFletero`, en
 * `lib/cantera/acarreo.ts`). Cantidad en cero borra el renglón, es la forma
 * de decir "ese día no hizo nada de esto" sin dejar un 0 que interpretar.
 */

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }

  const url = new URL(request.url);
  const fleteroId = url.searchParams.get("fletero_id") ?? undefined;
  const tipo = url.searchParams.get("tipo") ?? undefined;
  const mes = url.searchParams.get("mes") ?? undefined;
  if (mes && !/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ error: "El mes va como YYYY-MM" }, { status: 400 });
  }

  return NextResponse.json({ data: await traerAcarreos(supabase, { fleteroId, tipo, mes }) });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar acarreo" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  const fleteroId = String(b?.fletero_id ?? "");
  if (!fleteroId) return NextResponse.json({ error: "Falta el fletero" }, { status: 400 });
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
  // `mes` sigue siendo una columna real (la usa tarifaVigente y los filtros
  // mensuales) — se calcula acá, no se le pide a quien llama.
  const mesCompleto = `${b.fecha.slice(0, 7)}-01`;

  // Cero = "ese día no hizo nada de esto": se borra el renglón en vez de
  // guardar un 0 que después hay que distinguir de "no se cargó todavía".
  if (cantidad === 0) {
    const { error } = await supabase
      .from("cantera_acarreos")
      .delete()
      .eq("fletero_id", fleteroId)
      .eq("tipo", b.tipo)
      .eq("fecha", b.fecha);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data: null });
  }

  const { data, error } = await supabase
    .from("cantera_acarreos")
    .upsert(
      {
        fletero_id: fleteroId,
        tipo: b.tipo,
        fecha: b.fecha,
        mes: mesCompleto,
        cantidad,
        observaciones: typeof b?.observaciones === "string" ? b.observaciones.trim() || null : null,
        actualizado_por: user.id,
        actualizado_en: new Date().toISOString(),
        cargado_por: user.id,
      },
      { onConflict: "fletero_id,tipo,fecha" }
    )
    .select(
      "id, fletero_id, tipo, fecha, mes, cantidad, observaciones, origen, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en"
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
