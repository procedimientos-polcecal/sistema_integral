import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esMesValido, hoyEnArgentina } from "@/lib/core/fechas";
import { nivelRrhhDe } from "@/lib/rrhh/auth";
import { puedeVerLosReportes, reportesQueVe } from "@/lib/rrhh/ausentismo/armarReportes";
import { leerReportes } from "@/lib/rrhh/ausentismo/lecturas";

/**
 * Los tres reportes de ausentismo de un mes: el mensual por sector y motivo, el
 * anual por persona y el porcentual de horas perdidas. Reemplazan los dos que
 * RRHH llenaba a mano en la planilla de Google.
 *
 * `GET ?mes=AAAA-MM` (sin parámetro, el mes de hoy).
 *
 * **La respuesta no es la misma para todos.** Quien no pasa el control recibe
 * `{ mensual, avisos }` —con 200, no con 403—, y ese mensual viene **sin el
 * desglose por motivo**: cuánto se faltó en cada sector, no de qué. Quien pasa
 * recibe además `anual` y `porcentual`, y los motivos. Quien consuma esto
 * tiene que bancarse las dos formas.
 *
 * El porqué de ese recorte está en `reportesQueVe`, y en una frase: «agregado»
 * no es lo mismo que anónimo cuando el sector tiene una sola persona.
 *
 * Como lee con el cliente admin (`ausencias` está cerrada con
 * `tiene_acceso_rrhh()`), RLS no corre y **el permiso es el de acá**: no hay
 * otra puerta, y por eso el recorte se hace sobre el resultado y no se confía
 * en que la base filtre.
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
  const puedeVerPorPersona = puedeVerLosReportes(usuario?.rol, nivel);

  const mes = new URL(request.url).searchParams.get("mes") ?? hoyEnArgentina().slice(0, 7);
  if (!esMesValido(mes)) {
    return NextResponse.json({ error: "El mes tiene que ser AAAA-MM" }, { status: 400 });
  }

  try {
    const todo = await leerReportes(createAdminClient(), mes);
    return NextResponse.json(reportesQueVe(todo, puedeVerPorPersona));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
