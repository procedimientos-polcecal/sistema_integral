import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import {
  elMensajeDelChoque, elUpsertDeLaTarea, loQueFaltaParaArmar, YA_TIENE_CICLO,
} from "@/lib/mantenimiento/configurarElCiclo";

/**
 * POST — armar un ciclo encadenado nuevo.
 *
 * Hasta hoy los cuatro ciclos que existen los cargó una migración a mano. Ésta
 * es la primera manera de crear uno desde la aplicación.
 *
 * ── PRIMERO SE PREGUNTA SI EL EQUIPO YA TIENE CICLO, Y RECIÉN AHÍ SE ESCRIBE ─
 *
 * Esto **no** es defensa en profundidad del `unique (equipment_id)`: es lo que
 * impide que un alta fallida reconfigure un ciclo que está corriendo.
 *
 * Un ciclo apunta a dos filas de `mant_tareas_preventivas` y no copia sus
 * nombres, así que hay que asegurarse de que existan antes del insert. Son
 * `upsert` sobre la clave natural `(equipment_id, accion, componente)`, la
 * misma que usa la pantalla del catálogo — que es justamente la clave que ya
 * tienen las tareas del ciclo que ese equipo está corriendo. Con una pestaña
 * vieja —cuya lista de equipos se armó antes de que ese equipo recibiera un
 * ciclo— los dos `upsert` salían bien, le reescribían el `periodo_dias` a la
 * hija de un ciclo vivo, y recién entonces el insert chocaba y contestaba 409:
 * la pantalla decía «no se pudo armar» mientras acababa de reconfigurar el
 * generador (revisión del 25/11/2026).
 *
 * `elMensajeDelChoque` queda como lo que se diseñó para ser: la red para la
 * carrera de verdad, los milisegundos entre esta lectura y el insert.
 *
 * Reusar una tarea ya relevada en vez de duplicarla es a propósito, y si
 * estaba `DESCARTADA` la vuelve a confirmar — el modal lo avisa antes de
 * guardar. Lo que el `upsert` **no** pisa es el período de la madre:
 * `elUpsertDeLaTarea` conserva el que esa tarea ya tenía.
 *
 * Queda un final imperfecto aceptado: si el insert del ciclo falla por otra
 * cosa, quedan dos tareas confirmadas de más. Eso es recuperable desde el
 * catálogo y no genera nada solo; al revés —un ciclo apuntando a una tarea que
 * no se pudo escribir— no es ni siquiera posible, porque las FK son `not null`.
 *
 * ── EL CICLO NACE SIN ARRANCAR ─────────────────────────────────────────────
 *
 * `desde` y `vuelta_desde` van en null, como los cuatro de la semilla. El
 * arranque lo decide el primer cambio que se cierre, o una persona desde la
 * ficha del equipo; nada de eso se tipea acá.
 *
 * ── ESTA RUTA NO TOCA NINGUNA PLANILLA ─────────────────────────────────────
 *
 * Armar un ciclo no crea ninguna OT: la primera la crea el generador cuando el
 * ciclo arranque, y ésa sí se exporta por el camino de siempre. No hay campo
 * exportable que se toque acá.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Armar un ciclo requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const body = (await cuerpoJson(request)) ?? {};

  const problemas = loQueFaltaParaArmar(body);
  if (problemas.length > 0) {
    return NextResponse.json({ error: problemas.join(" ") }, { status: 400 });
  }

  const equipment_id = String(body.equipment_id).trim();
  const componente = String(body.componente).trim();
  const admin = createAdminClient();

  // Antes de tocar nada. Ver el bloque de arriba: lo que esto evita no es el
  // 409 sino que un alta fallida le cambie el plazo a un ciclo que corre.
  const { data: yaHay } = await admin
    .from("mant_ciclos_de_ot")
    .select("id")
    .eq("equipment_id", equipment_id)
    .maybeSingle();

  if (yaHay) return NextResponse.json({ error: YA_TIENE_CICLO }, { status: 409 });

  // Las del catálogo de ese equipo, para no pisarles lo que ya tienen.
  const { data: delCatalogo } = await admin
    .from("mant_tareas_preventivas")
    .select("accion, componente, periodo_dias")
    .eq("equipment_id", equipment_id);

  const ids: Record<"madre" | "hija", string> = { madre: "", hija: "" };

  for (const lado of ["madre", "hija"] as const) {
    const accion = String(body[lado === "madre" ? "accionMadre" : "accionHija"]).trim();

    const { data, error } = await admin
      .from("mant_tareas_preventivas")
      .upsert(
        {
          ...elUpsertDeLaTarea({
            lado,
            equipment_id,
            componente,
            accion,
            nombre: String(body[lado === "madre" ? "nombreMadre" : "nombreHija"]).trim(),
            periodo_dias: Number(body.periodo_dias),
            existente: (delCatalogo ?? []).find(
              (t) => t.accion === accion && t.componente === componente
            ) ?? null,
          }),
          decidido_por: user.id,
          decidido_en: new Date().toISOString(),
        },
        { onConflict: "equipment_id,accion,componente" }
      )
      .select("id")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? `No se pudo guardar la tarea ${lado}` },
        { status: 500 }
      );
    }

    ids[lado] = data.id as string;
  }

  const { data: ciclo, error } = await admin
    .from("mant_ciclos_de_ot")
    .insert({
      equipment_id,
      tarea_madre_id: ids.madre,
      tarea_hija_id: ids.hija,
      repeticiones: Number(body.repeticiones),
      especialidad: body.especialidad ? String(body.especialidad).trim() : null,
      horas_estimadas:
        body.horas_estimadas === null || body.horas_estimadas === undefined ||
        String(body.horas_estimadas).trim() === ""
          ? null
          : Number(body.horas_estimadas),
      desde: null,
      vuelta_desde: null,
      creado_por: user.id,
    })
    .select("id")
    .single();

  if (error) {
    // El único choque que esta pantalla puede provocar es el equipo repetido,
    // y llega acá sólo con dos pestañas abiertas o una página vieja. Se
    // contesta con una frase y no con el texto de Postgres.
    const choque = elMensajeDelChoque(error);
    if (choque) return NextResponse.json({ error: choque }, { status: 409 });

    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: { id: ciclo?.id ?? null } }, { status: 201 });
}
