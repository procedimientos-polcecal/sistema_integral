import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { leerValores, listarPestanas } from "@/lib/core/sheets";
import { cargarEnlaces, resolver } from "@/lib/mantenimiento/enlaces";
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
  const enlaces = await cargarEnlaces(admin);

  const registros: Record<string, unknown>[] = [];
  let sinEquipo = 0;

  for (let i = 0; i < filas.length - 1; i++) {
    const aviso = filaDeAviso(filas[i + 1], i + 2);
    if (!aviso) continue;

    const { equipment_id, sector_id } = resolver(enlaces, aviso);
    if (!equipment_id) sinEquipo += 1;

    registros.push({
      ...aviso,
      equipment_id,
      sector_id,
      synced_at: new Date().toISOString(),
    });
  }

  let guardados = 0;
  for (let i = 0; i < registros.length; i += 500) {
    const lote = registros.slice(i, i + 500);
    const { error } = await admin
      .from("avisos")
      .upsert(lote, { onConflict: "oa_number" });

    if (error) {
      await registrarSincronizacion({
        modulo: "mantenimiento", recurso: "avisos", ok: false, error: error.message,
      });
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    guardados += lote.length;
  }

  await registrarSincronizacion({
    modulo: "mantenimiento", recurso: "avisos", ok: true, filas: guardados,
  });
  return NextResponse.json({ leidas: filas.length - 1, guardados, sin_equipo: sinEquipo });
}
