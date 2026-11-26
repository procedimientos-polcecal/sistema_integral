import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { loQueFaltaParaArrancar } from "@/lib/mantenimiento/arranqueDelCiclo";

type Params = { params: Promise<{ id: string }> };

/**
 * GET — lo que hay que saber de un ciclo para hablar de él en una pantalla.
 *
 * Existe para el modal de «Fue un cambio», que se abre desde la OT: ahí lo
 * único que hay en la fila es `ciclo_id`, y para titularse con el nombre real
 * de la tarea madre —«Fue un cambio de martillos»— y para decir cuál es el
 * piso de la fecha hace falta el ciclo.
 *
 * **Las dos tareas se leen en una consulta aparte y no con un embed**, igual
 * que en `ordenes/[id]/fue-un-cambio`, que es la ruta a la que este GET sirve.
 * No es por la ambigüedad del par —embeberlo por la columna,
 * `madre:tarea_madre_id(...)`, ya elige el camino y es lo que hacen la ficha
 * del equipo y la Configuración—: es para que las dos lecturas gemelas estén
 * escritas igual. La de allá no puede ser un embed porque
 * `supabaseDeMentira` no los resuelve y esa ruta tiene test de ruta.
 *
 * Pide `puedeEditarMantenimiento` y no sólo sesión, porque lo único que lo
 * llama es una pantalla de edición: dar menos acceso del necesario se nota al
 * usarlo, darlo de más no se nota nunca.
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: ciclo } = await admin
    .from("mant_ciclos_de_ot")
    .select("id, repeticiones, desde, tarea_madre_id, tarea_hija_id")
    .eq("id", id)
    .maybeSingle();

  if (!ciclo) return NextResponse.json({ error: "No existe ese ciclo" }, { status: 404 });

  const { data: tareas } = await admin
    .from("mant_tareas_preventivas")
    .select("id, nombre, componente")
    .in("id", [ciclo.tarea_madre_id, ciclo.tarea_hija_id]);

  const madre = (tareas ?? []).find((t) => t.id === ciclo.tarea_madre_id);
  const hija = (tareas ?? []).find((t) => t.id === ciclo.tarea_hija_id);

  return NextResponse.json({
    data: {
      id: ciclo.id,
      repeticiones: ciclo.repeticiones,
      desde: ciclo.desde,
      tareaMadre: madre?.nombre ?? null,
      tareaHija: hija?.nombre ?? null,
      componente: hija?.componente ?? madre?.componente ?? null,
    },
  });
}

/**
 * PATCH — cargarle a un ciclo su punto de arranque.
 *
 * Son dos datos y los dos los sabe una persona: **desde cuándo** es el último
 * trabajo hecho del ciclo y **en qué vuelta** quedó. Hasta que estén, el ciclo
 * no genera ninguna OT — eso es por diseño y está explicado en
 * `arranqueDelCiclo.ts`: deducirlos del texto libre de 248 descripciones da
 * mal en dos de los cuatro equipos.
 *
 * **Esta ruta no toca ninguna planilla**: no cambia ninguna OT, sólo la
 * configuración del ciclo. Por eso no tiene cola de exportación ni aparece en
 * `revisar-exportaciones`; si algún día escribe, hay que declararla ahí.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Cargar el arranque de un ciclo requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const { data: ciclo } = await admin
    .from("mant_ciclos_de_ot")
    .select("id, repeticiones")
    .eq("id", id)
    .single();

  if (!ciclo) return NextResponse.json({ error: "No existe ese ciclo" }, { status: 404 });

  const body = await cuerpoJson(request);
  const falta = loQueFaltaParaArrancar(body ?? {}, ciclo.repeticiones);
  if (falta.length > 0) {
    return NextResponse.json({ error: `Falta ${falta.join(", ")}.` }, { status: 400 });
  }

  const { error } = await admin
    .from("mant_ciclos_de_ot")
    .update({ desde: String(body.desde), vuelta_desde: Number(body.vuelta_desde) })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data: { desde: String(body.desde), vuelta_desde: Number(body.vuelta_desde) },
  });
}
