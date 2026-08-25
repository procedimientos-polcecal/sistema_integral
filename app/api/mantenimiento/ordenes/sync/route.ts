import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { traerTodo } from "@/lib/core/paginado";
import { leerValores, listarPestanas } from "@/lib/core/sheets";
import { filaDeOrden } from "@/lib/mantenimiento/ordenes";

export const maxDuration = 300;

/**
 * Trae las órdenes de trabajo de su planilla.
 *
 * La planilla manda sobre lo que ya está cargado ahí. Las OT creadas desde el
 * sistema conservan su número y se reconocen por `app_created`.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sincronizar las órdenes requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const planilla = process.env.GOOGLE_SHEETS_OT_ID ?? "";
  const pestana = process.env.GOOGLE_SHEETS_OT_TAB ?? "OT";
  if (!planilla) {
    return NextResponse.json({ error: "Falta configurar GOOGLE_SHEETS_OT_ID" }, { status: 503 });
  }

  let filas: string[][];
  try {
    filas = await leerValores(planilla, pestana, { sinFormato: true });
  } catch (e) {
    let disponibles: string[] = [];
    try {
      disponibles = await listarPestanas(planilla);
    } catch {
      // Si tampoco se puede listar, el problema es de acceso y vale el de arriba.
    }
    return NextResponse.json(
      {
        error:
          `No se pudo leer la pestaña "${pestana}". ` +
          (disponibles.length > 0
            ? `La planilla tiene: ${disponibles.join(", ")}. Configurá GOOGLE_SHEETS_OT_TAB.`
            : e instanceof Error ? e.message : String(e)),
      },
      { status: 502 }
    );
  }

  if (filas.length < 2) return NextResponse.json({ leidas: 0, guardadas: 0, sin_equipo: 0 });

  const admin = createAdminClient();

  const equipos = await traerTodo<{ id: string; code: string | null; sector_id: string | null }>(
    (desde, hasta) => admin.from("equipos").select("id, code, sector_id").range(desde, hasta)
  );
  const sectores = await traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
    admin.from("sectores").select("id, nombre").range(desde, hasta)
  );

  const porCodigo = new Map(equipos.filter((e) => e.code).map((e) => [e.code!.toUpperCase(), e]));
  const porSector = new Map(sectores.map((s) => [s.nombre.toLowerCase().trim(), s.id]));

  const registros: Record<string, unknown>[] = [];
  let sinEquipo = 0;

  for (let i = 0; i < filas.length - 1; i++) {
    const orden = filaDeOrden(filas[i + 1], i + 2);
    if (!orden) continue;

    const equipo = orden.equipo_code ? porCodigo.get(orden.equipo_code) : undefined;
    if (!equipo) sinEquipo += 1;

    registros.push({
      ...orden,
      equipment_id: equipo?.id ?? null,
      sector_id:
        equipo?.sector_id ??
        porSector.get((orden.sector_raw ?? "").toLowerCase().trim()) ??
        null,
      synced_at: new Date().toISOString(),
    });
  }

  let guardadas = 0;
  for (let i = 0; i < registros.length; i += 500) {
    const lote = registros.slice(i, i + 500);
    const { error } = await admin
      .from("ordenes_trabajo")
      .upsert(lote, { onConflict: "ot_number" });

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    guardadas += lote.length;
  }

  return NextResponse.json({ leidas: filas.length - 1, guardadas, sin_equipo: sinEquipo });
}
