import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminCalidad } from "@/lib/calidad/auth";
import type { Determinacion } from "@/lib/calidad/ensayos/types";

/**
 * Los límites por producto y determinación.
 *
 * La tabla nace vacía y mientras lo esté el sistema no marca nada. Es la misma
 * decisión que los renglones del parte en Producción: la pieza existe desde el
 * primer día, así que el día que calidad decida los valores no hay que migrar
 * ni volver a tocar las pantallas.
 *
 * Spec: docs/superpowers/specs/2026-10-06-calidad-ensayos-design.md
 */

const CON_MALLA: Determinacion[] = ["retenido", "acumulado"];

const DETERMINACIONES: Determinacion[] = [
  "humedad",
  "peso_volumetrico",
  "cal_util_vial",
  "retenido",
  "acumulado",
];

interface CuerpoDelLimite {
  producto_id?: string;
  determinacion?: Determinacion;
  malla?: number | null;
  minimo?: number | null;
  maximo?: number | null;
}

function numeroONulo(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para editar los límites" }, { status: 403 });
  }

  const cuerpo = await cuerpoJson<CuerpoDelLimite>(request);

  if (!cuerpo.producto_id) {
    return NextResponse.json({ error: "Falta el producto." }, { status: 400 });
  }
  if (!cuerpo.determinacion || !DETERMINACIONES.includes(cuerpo.determinacion)) {
    return NextResponse.json({ error: "Falta la determinación." }, { status: 400 });
  }

  const llevaMalla = CON_MALLA.includes(cuerpo.determinacion);
  const malla = numeroONulo(cuerpo.malla);

  if (llevaMalla && (malla === null || !Number.isInteger(malla) || malla <= 0)) {
    return NextResponse.json(
      { error: "Un límite de retenido o acumulado es de una malla: falta cuál." },
      { status: 400 }
    );
  }
  if (!llevaMalla && malla !== null) {
    return NextResponse.json(
      { error: "La humedad, el peso volumétrico y la cal útil vial no tienen malla." },
      { status: 400 }
    );
  }

  const minimo = numeroONulo(cuerpo.minimo);
  const maximo = numeroONulo(cuerpo.maximo);

  if (minimo === null && maximo === null) {
    return NextResponse.json(
      { error: "Un límite necesita un mínimo, un máximo, o los dos." },
      { status: 400 }
    );
  }
  if (minimo !== null && maximo !== null && minimo > maximo) {
    return NextResponse.json({ error: "El mínimo no puede ser mayor que el máximo." }, { status: 400 });
  }

  // SELECT Y DESPUÉS INSERT O UPDATE, y no un upsert con `onConflict`: el único
  // que protege a las determinaciones sin malla es un índice **parcial**, y un
  // índice parcial no sirve como destino de un ON CONFLICT. Es la trampa 2 del
  // README de migraciones, y acá se habría manifestado como un 42P10 recién en
  // producción.
  const base = supabase
    .from("calidad_ensayos_limites")
    .select("id")
    .eq("producto_id", cuerpo.producto_id)
    .eq("determinacion", cuerpo.determinacion);

  // `malla is null` no se puede pedir con `.eq()`: en SQL nada es igual a NULL.
  const existente = await (malla === null ? base.is("malla", null) : base.eq("malla", malla))
    .maybeSingle();

  const valores = {
    producto_id: cuerpo.producto_id,
    determinacion: cuerpo.determinacion,
    malla,
    minimo,
    maximo,
  };

  if (existente.data?.id) {
    const { error } = await supabase
      .from("calidad_ensayos_limites")
      .update(valores)
      .eq("id", existente.data.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ id: existente.data.id });
  }

  const { data, error } = await supabase
    .from("calidad_ensayos_limites")
    .insert(valores)
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ id: data.id });
}

/**
 * Borrar un límite es volver a "esto no se controla", que es un estado válido
 * del módulo y en el que nace.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para editar los límites" }, { status: 403 });
  }

  const cuerpo = await cuerpoJson<{ id?: string }>(request);
  if (!cuerpo.id) return NextResponse.json({ error: "Falta el límite." }, { status: 400 });

  const { error } = await supabase.from("calidad_ensayos_limites").delete().eq("id", cuerpo.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
