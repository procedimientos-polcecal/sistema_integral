import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCalidad } from "@/lib/calidad/auth";
import { validarMuestra, type MuestraQueLlega } from "@/lib/calidad/ensayos/cuerpoDeLaMuestra";

/**
 * Cargar una muestra con sus retenidos.
 *
 * **Son dos escrituras y PostgREST no da transacciones multi-sentencia.** Si la
 * segunda falla, se borra la muestra recién creada: una muestra sin sus
 * retenidos no es una muestra a medias, es una granulometría que se lee como si
 * hubiera dado cero. Es la misma lección que los tres pasos de la recepción de
 * carbonilla, donde lo que no podía pasar era crear la orden dos veces.
 *
 * Spec: docs/superpowers/specs/2026-10-06-calidad-ensayos-design.md
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar muestras" }, { status: 403 });
  }

  const validado = validarMuestra(await cuerpoJson<MuestraQueLlega>(request));
  if ("problema" in validado) {
    return NextResponse.json({ error: validado.problema }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("calidad_ensayos_muestras")
    .insert({ ...validado.muestra, cargado_por: user.id })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (validado.retenidos.length > 0) {
    const { error: errorRetenidos } = await supabase
      .from("calidad_ensayos_retenidos")
      .insert(validado.retenidos.map((r) => ({ ...r, muestra_id: data.id })));

    if (errorRetenidos) {
      await supabase.from("calidad_ensayos_muestras").delete().eq("id", data.id);
      // Lo que dijo Postgres, sin traducir: un diagnóstico que no se distingue
      // de otro no es un diagnóstico.
      return NextResponse.json(
        { error: `No se pudieron guardar los retenidos: ${errorRetenidos.message}` },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ id: data.id });
}
