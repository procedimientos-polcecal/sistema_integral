import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esMesValido, hoyEnArgentina } from "@/lib/core/fechas";
import { nivelRrhhDe } from "@/lib/rrhh/auth";
import { puedeVerLosReportes } from "@/lib/rrhh/ausentismo/armarReportes";
import { leerReportes } from "@/lib/rrhh/ausentismo/lecturas";

/**
 * Los tres reportes de ausentismo de un mes: el mensual por sector y motivo, el
 * anual por persona y el porcentual de horas perdidas. Reemplazan los dos que
 * RRHH llenaba a mano en la planilla de Google.
 *
 * `GET ?mes=AAAA-MM` (sin parámetro, el mes de hoy)
 * → `{ mensual, anual, porcentual, avisos: string[] }`.
 *
 * Gateada a los `encargado`, los `admin_sistema` y quien tenga acceso a RRHH.
 * Como lee con el cliente admin (`ausencias` está cerrada con
 * `tiene_acceso_rrhh()`), RLS no corre y **el permiso es el de acá**: el
 * control va antes de la primera lectura, y no hay otra puerta.
 *
 * `avisos` va a la vista de quien mira el número: el mensual del sistema da más
 * que el de la planilla —ésta contaba sólo una lista fija de 17 sectores— y eso
 * tiene que estar dicho donde se lee la cifra, no al pie.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  const nivel = await nivelRrhhDe(supabase, user.id);
  if (!puedeVerLosReportes(usuario?.rol, nivel)) {
    return NextResponse.json(
      { error: "Los reportes de ausentismo los ven los encargados y quien tenga acceso a RRHH" },
      { status: 403 },
    );
  }

  const mes = new URL(request.url).searchParams.get("mes") ?? hoyEnArgentina().slice(0, 7);
  if (!esMesValido(mes)) {
    return NextResponse.json({ error: "El mes tiene que ser AAAA-MM" }, { status: 400 });
  }

  try {
    return NextResponse.json(await leerReportes(createAdminClient(), mes));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
