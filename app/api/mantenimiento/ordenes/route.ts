import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { leerValores, escribirCeldas } from "@/lib/core/sheets";
import { celdasParaRegistrar, type RegistroDeOT } from "@/lib/mantenimiento/ordenes";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const estado       = searchParams.get("estado");
  const equipment_id = searchParams.get("equipment_id");
  const especialidad = searchParams.get("especialidad");
  const search       = searchParams.get("q");
  const page         = Number(searchParams.get("page") ?? 1);
  const limit        = 50;

  let query = supabase
    .from("ordenes_trabajo")
    .select("*", { count: "exact" })
    .order("ot_number", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (estado)       query = query.eq("estado", estado);
  if (equipment_id) query = query.eq("equipment_id", equipment_id);
  if (especialidad) query = query.eq("especialidad", especialidad);
  if (search) {
    // Sanitizar: quitar caracteres que rompen el filtro PostgREST (,()*\)
    const safe = search.replace(/[,()*\\%]/g, "").trim();
    if (safe) {
      query = query.or(`descripcion.ilike.%${safe}%,equipo_raw.ilike.%${safe}%,sector_raw.ilike.%${safe}%`);
    }
  }

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data, count });
}

// ── POST: crear OT manualmente desde la app ─────────────────────────────────
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await request.json();
  const {
    equipment_id, sector_id, sector_raw, equipo_raw, equipo_code,
    especialidad, tipo, quien, descripcion, repuesto,
    fecha, fecha_ejecucion, fecha_cierre,
    estado, contratista, horas, operario_1, operario_2, operario_3, prioridad,
    schedule_id,
  } = body;

  if (!descripcion?.trim()) {
    return NextResponse.json({ error: "La descripción es requerida" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: last } = await admin
    .from("ordenes_trabajo").select("ot_number").order("ot_number", { ascending: false }).limit(1).single();
  const ot_number = (last?.ot_number ?? 0) + 1;

  const record = {
    ot_number,
    fecha:           fecha || new Date().toISOString().slice(0, 10),
    sector_id:       sector_id || null,
    sector_raw:      sector_raw || null,
    equipo_raw:      equipo_raw || null,
    equipo_code:     equipo_code || null,
    equipment_id:    equipment_id || null,
    especialidad:    especialidad || null,
    tipo:            tipo || null,
    quien:           quien || null,
    descripcion:     descripcion.trim(),
    repuesto:        repuesto?.trim() || null,
    fecha_ejecucion: fecha_ejecucion || null,
    fecha_cierre:    fecha_cierre || null,
    estado:          estado || "POR_HACER",
    contratista:     contratista?.trim() || null,
    horas:           horas ? Number(horas) : null,
    operario_1:      operario_1?.trim() || null,
    operario_2:      operario_2?.trim() || null,
    operario_3:      operario_3?.trim() || null,
    prioridad:       prioridad || null,
    schedule_id:     schedule_id || null,
    app_created:     true,
    created_by:      user.id,
    created_at_app:  new Date().toISOString(),
    requiere_parada_sector: Boolean(body.requiere_parada_sector),
    synced_at:       new Date().toISOString(),
  };

  const { data: inserted, error } = await admin
    .from("ordenes_trabajo").insert(record).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: inserted, ot_number });
}

// ── PATCH: actualizar estado de una OT desde la app ─────────────────────────
const VALID_ESTADOS = ["REALIZADO", "EN_PROCESO", "ATRASADO", "POR_HACER", "SUSPENDIDA"];

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await request.json();
  const { id, estado, requiere_parada_sector } = body ?? {};
  if (!id) return NextResponse.json({ error: "ID requerido" }, { status: 400 });

  // Lista blanca. No se acepta el resto del body para evitar escritura
  // arbitraria de columnas (mass-assignment).
  const update: Record<string, unknown> = { synced_at: new Date().toISOString() };

  if (estado !== undefined) {
    if (!VALID_ESTADOS.includes(estado)) {
      return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
    }
    update.estado = estado;
  }

  // Lo que se anota al registrar el trabajo. Cada uno tiene su columna en la
  // planilla, así que se guardan acá y se escriben allá.
  const registro: RegistroDeOT = {};
  const texto = (v: unknown) => String(v ?? "").trim() || null;

  for (const campo of ["contratista", "operario_1", "operario_2", "operario_3", "observaciones"] as const) {
    if (body[campo] !== undefined) {
      update[campo] = texto(body[campo]);
      registro[campo] = update[campo] as string | null;
    }
  }
  if (body.horas !== undefined) {
    const n = Number(body.horas);
    update.horas = body.horas === null || body.horas === "" || isNaN(n) ? null : n;
    registro.horas = update.horas as number | null;
  }
  if (body.fecha_cierre !== undefined) {
    update.fecha_cierre = body.fecha_cierre || null;
    registro.fecha_cierre = update.fecha_cierre as string | null;
  }
  if (estado !== undefined) registro.estado = estado;
  // La foto va a la planilla pero no a la tabla: acá vive en la ejecución.
  if (body.foto_url !== undefined) registro.foto_url = texto(body.foto_url);

  // Que el trabajo obligue a parar el sector no viene de la planilla: se marca
  // acá. Y se puede marcar en cualquier momento, no sólo al crear la OT: las
  // 1728 que vinieron de la planilla llegaron todas sin la marca.
  if (requiere_parada_sector !== undefined) {
    update.requiere_parada_sector = Boolean(requiere_parada_sector);
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: "No se envió ningún cambio" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: updated, error } = await admin
    .from("ordenes_trabajo").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const planilla_error = await escribirEnLaPlanilla(updated, registro);
  return NextResponse.json({ data: updated, planilla_error });
}

/**
 * Escribe en la planilla lo que se registró en la app.
 *
 * Best-effort: la app ya guardó, y que Google esté caído o que la planilla no
 * esté compartida como editor no puede tirar abajo el registro del trabajo. Se
 * devuelve el problema para que la pantalla lo muestre.
 *
 * Antes de escribir se comprueba que la fila **siga siendo la de esta OT**: el
 * número de fila que guardamos se corre si alguien inserta una fila arriba, y
 * escribir a ciegas pisaría el trabajo de otro.
 */
async function escribirEnLaPlanilla(
  orden: { ot_number: number | null; sheets_row: number | null },
  registro: RegistroDeOT
): Promise<string | null> {
  const celdas = celdasParaRegistrar(registro);
  if (celdas.length === 0) return null;

  const planilla = process.env.GOOGLE_SHEETS_OT_ID ?? "";
  const pestana = process.env.GOOGLE_SHEETS_OT_TAB ?? "OT";
  if (!planilla || !orden.sheets_row) return null;

  try {
    const fila = (await leerValores(
      planilla, `${pestana}!A${orden.sheets_row}:A${orden.sheets_row}`, { sinFormato: true }
    ))[0] ?? [];

    if (Number(fila[0]) !== orden.ot_number) {
      return "La fila de la planilla ya no es la de esta OT — alguien la movió. " +
             "Sincronizá las órdenes y volvé a intentar.";
    }

    await escribirCeldas(
      planilla,
      celdas.map((c) => ({ pestana, fila: orden.sheets_row!, columna: c.columna, valor: c.valor }))
    );
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
