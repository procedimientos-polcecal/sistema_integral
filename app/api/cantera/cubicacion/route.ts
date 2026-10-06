import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerCubicaciones } from "@/lib/cantera/consultas";

/**
 * El cierre mensual de cubicación de un yacimiento: sólo la existencia final
 * medida — lo demás (voladuras, acarreo, existencia inicial, lectura) se
 * calcula al leer, en `lib/cantera/cubicacion.ts`.
 *
 * `PATCH` es un upsert por (yacimiento, mes): cargar de nuevo el mismo
 * yacimiento+mes corrige el cierre, no lo duplica (`unique (yacimiento_id,
 * mes)` en la base) — mismo criterio que `/api/cantera/acarreos`.
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }

  return NextResponse.json({ data: await traerCubicaciones(supabase) });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar cubicación" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  const yacimientoId = String(b?.yacimiento_id ?? "");
  if (!yacimientoId) return NextResponse.json({ error: "Falta el yacimiento" }, { status: 400 });
  if (typeof b?.mes !== "string" || !/^\d{4}-\d{2}$/.test(b.mes)) {
    return NextResponse.json({ error: "El mes va como YYYY-MM" }, { status: 400 });
  }
  const existenciaFinal = Number(b?.existencia_final);
  if (!isFinite(existenciaFinal) || existenciaFinal < 0) {
    return NextResponse.json({ error: "La existencia final tiene que ser un número" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("cantera_cubicaciones")
    .upsert(
      {
        yacimiento_id: yacimientoId,
        mes: `${b.mes}-01`,
        existencia_final: existenciaFinal,
        observaciones: typeof b?.observaciones === "string" ? b.observaciones.trim() || null : null,
        actualizado_por: user.id,
        actualizado_en: new Date().toISOString(),
        cargado_por: user.id,
      },
      { onConflict: "yacimiento_id,mes" }
    )
    .select("id, yacimiento_id, mes, existencia_final, observaciones, cargado_por, cargado_en, actualizado_por, actualizado_en")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
