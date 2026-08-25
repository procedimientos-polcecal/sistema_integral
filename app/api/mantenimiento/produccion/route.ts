import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import {
  ESTADOS_PRODUCCION, normalizarSemana, normalizarTextos,
} from "@/lib/mantenimiento/produccion";

/**
 * El plan de producción de una semana.
 *
 * Una fila por sector y por semana, con los siete días. Se guarda entero: la
 * pantalla edita un día pero manda la semana, que es como está guardado.
 */

/** GET ?semana=aaaa-mm-dd */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const semana = new URL(request.url).searchParams.get("semana");
  if (!semana) return NextResponse.json({ error: "Falta la semana" }, { status: 400 });

  const { data, error } = await supabase
    .from("produccion_semanal")
    .select("*, sectores(nombre)")
    .eq("week_start", semana);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/** PUT: guarda el plan de un sector para una semana. */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Cargar la producción requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const semana = String(body?.week_start ?? "").trim();
  const sectorId = String(body?.sector_id ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(semana)) {
    return NextResponse.json({ error: "Semana inválida" }, { status: 400 });
  }
  if (!sectorId) return NextResponse.json({ error: "Falta el sector" }, { status: 400 });

  // Todo lo que llega de la pantalla se normaliza a siete: guardar un arreglo
  // de otro largo rompería la grilla al leerla.
  const { data, error } = await createAdminClient()
    .from("produccion_semanal")
    .upsert(
      {
        week_start: semana,
        sector_id: sectorId,
        days: normalizarSemana(body?.days, ESTADOS_PRODUCCION, "LIBRE"),
        motivos: normalizarTextos(body?.motivos),
        turnos: normalizarTextos(body?.turnos),
        responsable: String(body?.responsable ?? "").trim() || null,
        note: String(body?.note ?? "").trim() || null,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "week_start,sector_id" }
    )
    .select("*, sectores(nombre)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
