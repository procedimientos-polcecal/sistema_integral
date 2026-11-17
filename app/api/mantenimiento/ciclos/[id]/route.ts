import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { loQueFaltaParaArrancar } from "@/lib/mantenimiento/arranqueDelCiclo";

type Params = { params: Promise<{ id: string }> };

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
