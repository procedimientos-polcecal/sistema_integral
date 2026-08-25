import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { traerTodo } from "@/lib/core/paginado";
import { leerValores, listarPestanas } from "@/lib/core/sheets";
import { filaDeAviso } from "@/lib/mantenimiento/avisos";

export const maxDuration = 300;

/**
 * Trae los avisos de su planilla de Google.
 *
 * La planilla manda: acá es un espejo. Se lee sin formato para que las fechas
 * lleguen como serial y no como texto que depende del locale.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sincronizar los avisos requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const planilla = process.env.GOOGLE_SHEETS_AVISOS_ID ?? "";
  const pestana = process.env.GOOGLE_SHEETS_AVISOS_TAB ?? "AVISOS";
  if (!planilla) {
    return NextResponse.json(
      { error: "Falta configurar GOOGLE_SHEETS_AVISOS_ID" },
      { status: 503 }
    );
  }

  let filas: string[][];
  try {
    filas = await leerValores(planilla, pestana, { sinFormato: true });
  } catch (e) {
    // El error de Google no dice qué pestañas hay, y adivinar el nombre es la
    // primera cosa que sale mal. Se lo decimos.
    let disponibles: string[] = [];
    try {
      disponibles = await listarPestanas(planilla);
    } catch {
      // Si tampoco se puede listar, el problema es de acceso: vale el error de arriba.
    }
    return NextResponse.json(
      {
        error:
          `No se pudo leer la pestaña "${pestana}". ` +
          (disponibles.length > 0
            ? `La planilla tiene: ${disponibles.join(", ")}. Configurá GOOGLE_SHEETS_AVISOS_TAB.`
            : e instanceof Error ? e.message : String(e)),
      },
      { status: 502 }
    );
  }

  if (filas.length < 2) return NextResponse.json({ leidas: 0, guardados: 0, sin_equipo: 0 });

  const admin = createAdminClient();

  // Con qué enlazar cada aviso: el equipo por código, y el sector por nombre
  // cuando el equipo no se pudo identificar.
  const equipos = await traerTodo<{ id: string; code: string | null; sector_id: string | null }>(
    (desde, hasta) => admin.from("equipos").select("id, code, sector_id").range(desde, hasta)
  );
  const sectores = await traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
    admin.from("sectores").select("id, nombre").range(desde, hasta)
  );

  const porCodigo = new Map(
    equipos.filter((e) => e.code).map((e) => [e.code!.toUpperCase(), e])
  );
  const porSector = new Map(sectores.map((s) => [s.nombre.toLowerCase().trim(), s.id]));

  const registros: Record<string, unknown>[] = [];
  let sinEquipo = 0;

  for (let i = 0; i < filas.length - 1; i++) {
    const aviso = filaDeAviso(filas[i + 1], i + 2);
    if (!aviso) continue;

    const equipo = aviso.equipo_code ? porCodigo.get(aviso.equipo_code) : undefined;
    if (!equipo) sinEquipo += 1;

    registros.push({
      ...aviso,
      equipment_id: equipo?.id ?? null,
      sector_id:
        equipo?.sector_id ??
        porSector.get((aviso.sector_raw ?? "").toLowerCase().trim()) ??
        null,
      synced_at: new Date().toISOString(),
    });
  }

  let guardados = 0;
  for (let i = 0; i < registros.length; i += 500) {
    const lote = registros.slice(i, i + 500);
    const { error } = await admin
      .from("avisos")
      .upsert(lote, { onConflict: "oa_number" });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    guardados += lote.length;
  }

  return NextResponse.json({ leidas: filas.length - 1, guardados, sin_equipo: sinEquipo });
}
