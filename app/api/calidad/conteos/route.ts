import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCalidad, tieneAccesoCalidad } from "@/lib/calidad/auth";
import { teoricoDe } from "@/lib/calidad/consultas";
import { desvioDelConteo } from "@/lib/calidad/conteos";
import { exportarMovimiento } from "@/lib/calidad/espejo";
import type { CarbonReal } from "@/lib/calidad/types";

/**
 * El conteo físico y, si se explicó por qué, el ajuste que lo cierra.
 *
 * EL CONTEO SIN AJUSTE ES UN ESTADO VÁLIDO. Obligar a ajustar en el momento
 * haría que alguien escriba cualquier cosa en el motivo para poder seguir, y un
 * motivo de relleno en un ajuste de 247 toneladas es peor que ningún ajuste. En
 * veinte meses hubo 34 conteos y el saldo teórico siguió de largo en casi todos;
 * la diferencia es que ahora se ve.
 */

/** El teórico de hoy, para que la pantalla muestre el desvío mientras se tipea. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Calidad" }, { status: 403 });
  }

  const carbon = new URL(request.url).searchParams.get("carbon");
  if (carbon !== "vegetal" && carbon !== "residual") {
    return NextResponse.json({ error: "Falta el tipo de carbón." }, { status: 400 });
  }
  return NextResponse.json({ teorico: await teoricoDe(supabase, carbon) });
}

interface CuerpoDelConteo {
  fecha: string;
  carbon: CarbonReal;
  toneladas_contadas: number;
  motivo?: string | null;
  notas?: string | null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar conteos" }, { status: 403 });
  }

  const cuerpo = await cuerpoJson<CuerpoDelConteo>(request);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cuerpo.fecha ?? "")) {
    return NextResponse.json({ error: "Falta la fecha del conteo." }, { status: 400 });
  }
  if (cuerpo.carbon !== "vegetal" && cuerpo.carbon !== "residual") {
    return NextResponse.json({ error: "Falta el tipo de carbón." }, { status: 400 });
  }

  // EL TEÓRICO SE CONGELA ACÁ. No es el saldo de hoy leído mañana: es el que el
  // sistema decía en este momento. Si después se corrige un movimiento viejo, el
  // desvío que una persona miró y explicó tiene que poder reconstruirse.
  const teorico = await teoricoDe(supabase, cuerpo.carbon);
  const d = desvioDelConteo(Number(cuerpo.toneladas_contadas), teorico);
  if (d.problema) return NextResponse.json({ error: d.problema }, { status: 400 });

  const { data: conteo, error } = await supabase
    .from("calidad_conteos")
    .insert({
      fecha: cuerpo.fecha,
      carbon: cuerpo.carbon,
      toneladas_contadas: Number(cuerpo.toneladas_contadas),
      teorico_al_contar: teorico,
      notas: (cuerpo.notas ?? "").trim() || null,
      cargado_por: user.id,
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const motivo = (cuerpo.motivo ?? "").trim();
  if (!d.hayDesvio || !motivo) {
    return NextResponse.json({
      conteo_id: conteo.id,
      teorico,
      desvio: d.desvio,
      ajustado: false,
    });
  }

  const { data: ajuste, error: errorAjuste } = await supabase
    .from("calidad_movimientos")
    .insert({
      fecha: cuerpo.fecha,
      tipo: "ajuste",
      carbon: cuerpo.carbon,
      toneladas: d.ajuste!.toneladas,
      motivo,
      origen: "manual",
      cargado_por: user.id,
    })
    .select("id")
    .single();

  if (errorAjuste) {
    // El conteo ya quedó guardado y eso está bien: es un dato por sí mismo.
    return NextResponse.json(
      { conteo_id: conteo.id, teorico, desvio: d.desvio, ajustado: false, error: errorAjuste.message },
      { status: 400 }
    );
  }

  await supabase.from("calidad_conteos").update({ ajuste_id: ajuste.id }).eq("id", conteo.id);
  const { aviso } = await exportarMovimiento(supabase, ajuste.id);

  return NextResponse.json({
    conteo_id: conteo.id,
    teorico,
    desvio: d.desvio,
    ajustado: true,
    ajuste_id: ajuste.id,
    aviso,
  });
}
