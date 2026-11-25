import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { elMensajeDelChoque, loQueFaltaParaArmar } from "@/lib/mantenimiento/configurarElCiclo";

/**
 * POST — armar un ciclo encadenado nuevo.
 *
 * Hasta hoy los cuatro ciclos que existen los cargó una migración a mano. Ésta
 * es la primera manera de crear uno desde la aplicación.
 *
 * ── PRIMERO LAS TAREAS, DESPUÉS EL CICLO ───────────────────────────────────
 *
 * Un ciclo apunta a dos filas de `mant_tareas_preventivas` y no copia sus
 * nombres: por eso hay que asegurarse de que existan antes. Son `upsert` sobre
 * la clave natural `(equipment_id, accion, componente)`, la misma que usa la
 * pantalla del catálogo, así que armar un ciclo sobre una tarea ya relevada la
 * reusa en vez de duplicarla — y si estaba `DESCARTADA`, la vuelve a
 * confirmar, que es lo que el modal avisa antes de guardar.
 *
 * El orden importa en el otro sentido también: si el insert del ciclo falla,
 * quedan dos tareas confirmadas de más. Eso es recuperable desde el catálogo y
 * no genera nada solo; al revés —un ciclo apuntando a una tarea que no se
 * pudo escribir— no es ni siquiera posible, porque las FK son `not null`.
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

  const ids: Record<"madre" | "hija", string> = { madre: "", hija: "" };

  for (const lado of ["madre", "hija"] as const) {
    const { data, error } = await admin
      .from("mant_tareas_preventivas")
      .upsert(
        {
          equipment_id,
          componente,
          accion: String(body[lado === "madre" ? "accionMadre" : "accionHija"]).trim(),
          nombre: String(body[lado === "madre" ? "nombreMadre" : "nombreHija"]).trim(),
          estado: "CONFIRMADA",
          // El plazo es de la hija: es cada cuánto se repite. La madre lo deja
          // en null, como la semilla — cuándo vuelve lo decide la cuenta de
          // vueltas, no un período propio.
          periodo_dias: lado === "hija" ? Number(body.periodo_dias) : null,
          // Una confirmada no conserva el motivo de cuando se la descartó. Es
          // la regla de la ruta del catálogo, donde está explicada.
          motivo: null,
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
