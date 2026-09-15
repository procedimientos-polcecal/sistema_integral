import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerAcarreos } from "@/lib/cantera/consultas";
import { esTipoDeAcarreoValido } from "@/lib/cantera/acarreo";

/**
 * El acarreo de un fletero: un total por tipo y mes — el mismo nivel que la
 * pestaña "Ingreso de Datos" de la planilla de balanza (un renglón por
 * fletero y material/actividad, con el total del mes).
 *
 * `GET` filtra por fletero y/o mes. `PATCH` es un upsert: cargar de nuevo el
 * mismo fletero+tipo+mes corrige el total, no lo duplica (`unique
 * (fletero_id, tipo, mes)` en la base). Cantidad en cero borra el renglón —
 * es la forma de decir "este mes no hizo nada de esto" sin dejar una fila con
 * un 0 que hay que interpretar.
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
  const mes = url.searchParams.get("mes") ?? undefined;
  if (mes && !/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ error: "El mes va como YYYY-MM" }, { status: 400 });
  }

  return NextResponse.json({ data: await traerAcarreos(supabase, { fleteroId, mes }) });
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
  if (typeof b?.mes !== "string" || !/^\d{4}-\d{2}$/.test(b.mes)) {
    return NextResponse.json({ error: "El mes va como YYYY-MM" }, { status: 400 });
  }
  const mesCompleto = `${b.mes}-01`;
  const cantidad = Number(b?.cantidad);
  if (!isFinite(cantidad) || cantidad < 0) {
    return NextResponse.json({ error: "La cantidad tiene que ser un número" }, { status: 400 });
  }

  // Cero = "no hizo nada de esto este mes": se borra el renglón en vez de
  // guardar un 0 que después hay que distinguir de "no se cargó todavía".
  if (cantidad === 0) {
    const { error } = await supabase
      .from("cantera_acarreos")
      .delete()
      .eq("fletero_id", fleteroId)
      .eq("tipo", b.tipo)
      .eq("mes", mesCompleto);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ data: null });
  }

  const { data, error } = await supabase
    .from("cantera_acarreos")
    .upsert(
      {
        fletero_id: fleteroId,
        tipo: b.tipo,
        mes: mesCompleto,
        cantidad,
        observaciones: typeof b?.observaciones === "string" ? b.observaciones.trim() || null : null,
        actualizado_por: user.id,
        actualizado_en: new Date().toISOString(),
        cargado_por: user.id,
      },
      { onConflict: "fletero_id,tipo,mes" }
    )
    .select(
      "id, fletero_id, tipo, mes, cantidad, observaciones, origen, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en"
    )
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
