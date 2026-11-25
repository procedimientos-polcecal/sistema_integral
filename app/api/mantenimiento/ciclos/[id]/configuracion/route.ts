import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import {
  elResetPorCambioDeTareas, loQueImpideGuardar, type Parametros,
} from "@/lib/mantenimiento/configurarElCiclo";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH — los parámetros de un ciclo encadenado.
 *
 * El plazo, las repeticiones, la especialidad, las horas estimadas y el
 * interruptor. **No** el arranque ni el reinicio: ésos son actos operativos y
 * viven en la ficha del equipo (`ciclos/[id]` y `ciclos/[id]/reiniciar`).
 *
 * ── EL PLAZO NO ES UNA COLUMNA DEL CICLO ───────────────────────────────────
 *
 * Es el `periodo_dias` de la **tarea hija** en `mant_tareas_preventivas`, y se
 * escribe ahí. No hay copia: es el mismo número que muestra la pantalla del
 * catálogo y el mismo del que lee el generador. Guardar una copia en el ciclo
 * sería dos lugares que divergen sin que nada avise.
 *
 * ── ESTA RUTA NO TOCA NINGUNA PLANILLA ─────────────────────────────────────
 *
 * Configurar un ciclo no cambia ninguna OT, así que no hay nada que exportar y
 * no lleva cola de pendientes. Si algún día escribe, hay que declararla en
 * `scripts/revisar-exportaciones.mjs`.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Configurar un ciclo requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const { data: ciclo } = await admin
    .from("mant_ciclos_de_ot")
    .select("id, repeticiones, vuelta_desde, tarea_madre_id, tarea_hija_id")
    .eq("id", id)
    .single();

  if (!ciclo) return NextResponse.json({ error: "No existe ese ciclo" }, { status: 404 });

  const body = (await cuerpoJson(request)) ?? {};
  const cambios = loQueLlegó(body);

  const problemas = loQueImpideGuardar(cambios, ciclo);
  if (problemas.length > 0) {
    return NextResponse.json({ error: problemas.join(" ") }, { status: 400 });
  }

  // El plazo primero: si falla, el ciclo queda como estaba y el error es uno
  // solo. Al revés habría que deshacer lo del ciclo.
  if (cambios.periodo_dias !== undefined) {
    // Si la hija también está cambiando, el plazo es el de la **nueva**: lo
    // que se tipeó en la pantalla describe el ciclo que queda, no el que fue.
    //
    // `decidido_por`/`decidido_en` se mueven igual que desde el catálogo: cada
    // cuánto va una tarea **es** parte de lo que esa pantalla pide decidir, y
    // dejarlos viejos diría que el período lo fijó quien ya no lo fijó.
    const { error } = await admin
      .from("mant_tareas_preventivas")
      .update({
        periodo_dias: cambios.periodo_dias,
        decidido_por: user.id,
        decidido_en: new Date().toISOString(),
      })
      .eq("id", cambios.tarea_hija_id ?? ciclo.tarea_hija_id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const delCiclo: Record<string, unknown> = {};
  if (cambios.repeticiones !== undefined) delCiclo.repeticiones = cambios.repeticiones;
  if (cambios.especialidad !== undefined) delCiclo.especialidad = cambios.especialidad;
  if (cambios.horas_estimadas !== undefined) delCiclo.horas_estimadas = cambios.horas_estimadas;
  if (cambios.activo !== undefined) delCiclo.activo = cambios.activo;
  if (cambios.tarea_madre_id !== undefined) delCiclo.tarea_madre_id = cambios.tarea_madre_id;
  if (cambios.tarea_hija_id !== undefined) delCiclo.tarea_hija_id = cambios.tarea_hija_id;

  // Cambiar el par de tareas deja el ciclo sin arrancar: `desde` y
  // `vuelta_desde` describían el par viejo y no se pueden traducir.
  const reset = elResetPorCambioDeTareas(cambios, ciclo);
  if (reset) Object.assign(delCiclo, reset);

  if (Object.keys(delCiclo).length > 0) {
    const { error } = await admin.from("mant_ciclos_de_ot").update(delCiclo).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: { ...cambios, reseteado: reset !== null } });
}

/**
 * Qué campos vinieron de verdad.
 *
 * La diferencia entre «no lo mandaron» y «lo mandaron vacío» decide todo acá:
 * un `periodo_dias` ausente deja el plazo como está, y uno en `null` lo vacía
 * —que es legítimo y detiene el ciclo—. Por eso no alcanza con un `??`.
 */
function loQueLlegó(body: Record<string, unknown>): Parametros {
  const p: Parametros = {};

  if ("periodo_dias" in body) {
    p.periodo_dias = body.periodo_dias === null || body.periodo_dias === ""
      ? null
      : Number(body.periodo_dias);
  }
  if ("repeticiones" in body) p.repeticiones = Number(body.repeticiones);
  if ("especialidad" in body) {
    p.especialidad = body.especialidad ? String(body.especialidad) : null;
  }
  if ("horas_estimadas" in body) {
    p.horas_estimadas = body.horas_estimadas === null || body.horas_estimadas === ""
      ? null
      : Number(body.horas_estimadas);
  }
  if ("activo" in body) p.activo = Boolean(body.activo);
  if ("tarea_madre_id" in body) p.tarea_madre_id = String(body.tarea_madre_id);
  if ("tarea_hija_id" in body) p.tarea_hija_id = String(body.tarea_hija_id);

  return p;
}
