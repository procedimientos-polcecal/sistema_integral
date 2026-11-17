import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { traerTodo } from "@/lib/core/paginado";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { catalogoPropuesto, type OrdenPreventiva } from "@/lib/mantenimiento/tareasPreventivas";
import {
  cruzarConLasDecisiones, loQueFaltaParaDecidir, type DecisionGuardada,
} from "@/lib/mantenimiento/catalogoConfirmado";
import { sumarDias, hoyEnArgentina } from "@/lib/core/fechas";

/**
 * El catálogo de tareas preventivas: lo que propone el historial y lo que
 * decidió una persona.
 *
 * LA PROPUESTA SE RECALCULA EN CADA LECTURA, no se guarda. Qué tareas hay, en
 * qué equipos y con qué ritmo sale de las OT de los últimos 365 días;
 * `mant_tareas_preventivas` guarda sólo la decisión. El porqué está en el
 * encabezado de la migración `20261112101003` y en
 * `lib/mantenimiento/catalogoConfirmado.ts`.
 *
 * POR QUÉ NO ESCRIBE EN NINGUNA PLANILLA. Igual que el MTBF y el MTTR, esto es
 * una cuenta derivada de datos que ya viajan por la sincronización de OT, más
 * una decisión que no tiene columna del otro lado. No hay campo exportable que
 * se toque, así que la regla de «toda ruta que toque un campo que se exporta
 * tiene que exportar» no aplica. Si algún día el catálogo se exporta, ahí sí.
 *
 * POR QUÉ NO HAY AUDITORÍA. La regla del núcleo es auditar lo que no se
 * deshace. Confirmar o descartar una tarea se deshace escribiendo la decisión
 * contraria, y el upsert deja `decidido_por` y `decidido_en` en la propia fila:
 * quién decidió y cuándo se contesta sin la tabla de auditoría.
 */

/** La misma ventana que el MTBF, el MTTR y el catálogo: 365 días. */
const VENTANA_DIAS = 365;

/** Lee las dos mitades: el historial y lo decidido. */
async function elCatalogo(supabase: Awaited<ReturnType<typeof createClient>>) {
  const hasta = hoyEnArgentina();
  const desde = sumarDias(hasta, -(VENTANA_DIAS - 1));

  // `ordenes_trabajo` pasa las 2.400 filas y PostgREST corta en 1000 sin
  // avisar; sin `traerTodo` el catálogo sale a la mitad y sin error.
  const [ordenes, componentesDb, decisiones] = await Promise.all([
    traerTodo<OrdenPreventiva>((de, a) =>
      supabase
        .from("ordenes_trabajo")
        .select("ot_number, descripcion, equipment_id, fecha_ejecucion")
        .eq("tipo", "PROGRAMADO")
        .gte("fecha_ejecucion", desde)
        .order("ot_number")
        .range(de, a)
    ),
    traerTodo<{ nombre: string | null }>((de, a) =>
      supabase.from("equipos_componentes").select("nombre").range(de, a)
    ),
    traerTodo<DecisionGuardada>((de, a) =>
      supabase
        .from("mant_tareas_preventivas")
        .select("equipment_id, accion, componente, nombre, periodo_dias, estado, motivo")
        .order("equipment_id")
        .range(de, a)
    ),
  ]);

  const componentes = [
    ...new Set(componentesDb.map((c) => c.nombre).filter((n): n is string => !!n)),
  ];

  return cruzarConLasDecisiones(catalogoPropuesto(ordenes, componentes), decisiones);
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    return NextResponse.json(await elCatalogo(supabase));
  } catch (error: unknown) {
    const detalle = error instanceof Error ? error.message : "error desconocido";
    return NextResponse.json(
      { error: `No se pudo armar el catálogo: ${detalle}` },
      { status: 500 }
    );
  }
}

/**
 * Confirmar o descartar una tarea sobre un equipo.
 *
 * Es un **upsert sobre la clave natural** `(equipment_id, accion, componente)`:
 * decidir dos veces sobre lo mismo corrige la decisión en vez de duplicarla, y
 * por eso cambiar de opinión —confirmar algo descartado, o al revés— es el
 * mismo pedido y no hace falta borrar nada.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await cuerpoJson(request);
  const equipment_id = String(body?.equipment_id ?? "").trim();
  if (!equipment_id) {
    return NextResponse.json({ error: "Falta el equipo" }, { status: 400 });
  }

  const falta = loQueFaltaParaDecidir({
    accion: body?.accion,
    componente: body?.componente,
    nombre: body?.nombre,
    estado: body?.estado,
    periodo_dias: body?.periodo_dias,
  });
  if (falta.length > 0) {
    return NextResponse.json({ error: `Falta cargar ${falta.join(", ")}.` }, { status: 400 });
  }

  // Vacío es "no lo decidí todavía" y viaja como null, no como 0.
  const periodo = String(body?.periodo_dias ?? "").trim();

  const admin = createAdminClient();
  const { error } = await admin
    .from("mant_tareas_preventivas")
    .upsert(
      {
        equipment_id,
        accion: String(body.accion).trim(),
        componente: String(body.componente).trim(),
        nombre: String(body.nombre).trim(),
        estado: String(body.estado).trim(),
        periodo_dias: periodo ? Number(periodo) : null,
        // El motivo sólo tiene sentido en una descartada: guardarlo en una
        // confirmada dejaría colgado el texto de cuando se la había rechazado.
        motivo:
          String(body.estado).trim() === "DESCARTADA"
            ? String(body?.motivo ?? "").trim() || null
            : null,
        decidido_por: user.id,
        decidido_en: new Date().toISOString(),
      },
      { onConflict: "equipment_id,accion,componente" }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    return NextResponse.json(await elCatalogo(supabase));
  } catch {
    // La decisión ya se guardó: que la relectura falle no la deshace, y
    // contestar un 500 acá haría pensar que no se guardó.
    return NextResponse.json({ guardado: true });
  }
}

/**
 * Volver una decisión a "propuesta".
 *
 * Borra la fila, que es lo que la devuelve al estado en que la dejó el
 * historial. No es lo mismo que descartarla: descartar es decir «ya la miré y
 * no va», y esto es «me equivoqué al decidir».
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await cuerpoJson(request);
  const equipment_id = String(body?.equipment_id ?? "").trim();
  const accion = String(body?.accion ?? "").trim();
  const componente = String(body?.componente ?? "").trim();
  if (!equipment_id || !accion || !componente) {
    return NextResponse.json({ error: "Falta el equipo, la acción o el componente" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("mant_tareas_preventivas")
    .delete()
    .eq("equipment_id", equipment_id)
    .eq("accion", accion)
    .eq("componente", componente);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    return NextResponse.json(await elCatalogo(supabase));
  } catch {
    return NextResponse.json({ borrado: true });
  }
}
