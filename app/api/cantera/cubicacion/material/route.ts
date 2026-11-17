import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCantera } from "@/lib/cantera/auth";
import { esMaterialDeCantera, MATERIALES_DE_CANTERA, MES_DE_CORTE_POR_MATERIAL } from "@/lib/cantera/cubicacionPorMaterial";

/**
 * El cierre mensual de C1+C3: la existencia final de **los dos materiales**
 * (Chocolata y Caliza), cada una en las canteras y en galpones/acopios por
 * triturar. El balance cierra con la suma de las dos, así que se cargan juntas
 * y de una sola vez: con una sola, la suma parecería completa y daría un
 * residuo falso por la mitad que falta (si de verdad no hay caliza, va 0).
 * Voladuras, acarreo, existencia inicial y lectura se calculan al leer
 * (`lib/cantera/cubicacionPorMaterial.ts`).
 *
 * `PATCH` es un upsert por (mes, material): cargar de nuevo corrige el cierre,
 * no lo duplica (`unique (mes, material)` en la base). Las dos filas van en un
 * solo `upsert`, que es una sola sentencia: se guardan las dos o ninguna.
 *
 * Cuerpo: `{ mes: "YYYY-MM", materiales: [{ material, existencia_final,
 * existencia_acopio }, …] }`.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar cubicación" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  if (typeof b?.mes !== "string" || !/^\d{4}-\d{2}$/.test(b.mes)) {
    return NextResponse.json({ error: "El mes va como YYYY-MM" }, { status: 400 });
  }
  // Antes del mes de corte C1 y C3 se cierran cada una por su cuenta.
  if (b.mes < MES_DE_CORTE_POR_MATERIAL) {
    return NextResponse.json(
      { error: `Antes de ${MES_DE_CORTE_POR_MATERIAL} C1 y C3 se cierran cada una por su cuenta, no juntas` },
      { status: 400 }
    );
  }
  if (!Array.isArray(b?.materiales)) {
    return NextResponse.json({ error: "Faltan los materiales" }, { status: 400 });
  }

  const ahora = new Date().toISOString();
  const filas: Record<string, unknown>[] = [];
  for (const m of b.materiales as Record<string, unknown>[]) {
    if (!esMaterialDeCantera(m?.material)) {
      return NextResponse.json({ error: "El material es Chocolata o Caliza" }, { status: 400 });
    }
    const final = Number(m.existencia_final);
    if (m.existencia_final === "" || m.existencia_final == null || !isFinite(final) || final < 0) {
      return NextResponse.json({ error: `La existencia final de ${m.material} en las canteras tiene que ser un número` }, { status: 400 });
    }
    // Acopio: opcional, vacío es "sin medir" y no un cero.
    const crudo = m.existencia_acopio;
    const acopio = crudo === undefined || crudo === null || crudo === "" ? null : Number(crudo);
    if (acopio !== null && (!isFinite(acopio) || acopio < 0)) {
      return NextResponse.json({ error: `La existencia de ${m.material} en galpones y acopios tiene que ser un número` }, { status: 400 });
    }
    filas.push({
      mes: `${b.mes}-01`,
      material: m.material,
      existencia_final: final,
      existencia_acopio: acopio,
      actualizado_por: user.id,
      actualizado_en: ahora,
      cargado_por: user.id,
    });
  }

  const faltan = MATERIALES_DE_CANTERA.filter((mat) => !filas.some((f) => f.material === mat));
  if (faltan.length > 0 || filas.length !== MATERIALES_DE_CANTERA.length) {
    return NextResponse.json({ error: "Hay que cargar Chocolata y Caliza, una vez cada una (si no hay caliza, 0)" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("cantera_cubicaciones_material")
    .upsert(filas, { onConflict: "mes,material" })
    .select("id, mes, material, existencia_final, existencia_acopio");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
