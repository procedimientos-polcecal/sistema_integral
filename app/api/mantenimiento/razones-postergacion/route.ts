import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento, puedeVerMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { MAXIMO_DE_DIAS } from "@/lib/mantenimiento/postergar";

/**
 * Las razones por las que se posterga una OT, y cuántos días sugiere cada una.
 *
 * **El menú calibra, no inventa.** El `codigo` de cada razón es vocabulario
 * cerrado del lado del código: de cada uno va a colgar una comprobación el día
 * que la postergación automática entre —«¿está el repuesto?», «¿está el
 * operario?»—. Lo que esta pantalla decide es cuáles se ofrecen, con qué
 * etiqueta y con cuántos días. Por eso el POST **no crea** razones nuevas:
 * actualiza las que existen.
 *
 * Si mañana hace falta una razón nueva, se agrega con su comprobación, no con
 * una fila. Una razón sin nada detrás es un desplegable que no hace nada.
 */

/** GET — las razones, en el orden en que se muestran. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeVerMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("mant_razones_de_postergacion")
    .select("codigo, etiqueta, dias, activa, orden")
    .order("orden")
    .order("etiqueta");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/** PATCH — cambiarle los días, la etiqueta o si está activa a una razón. */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Cambiar las razones requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const body = await cuerpoJson(request);
  const codigo = String(body?.codigo ?? "").trim();
  if (!codigo) return NextResponse.json({ error: "Falta la razón" }, { status: 400 });

  const update: Record<string, unknown> = {};

  if (body.etiqueta !== undefined) {
    const etiqueta = String(body.etiqueta).trim();
    if (!etiqueta) {
      return NextResponse.json({ error: "La etiqueta no puede quedar vacía" }, { status: 400 });
    }
    update.etiqueta = etiqueta;
  }

  if (body.dias !== undefined) {
    const dias = Number(body.dias);
    // El mismo tope que la postergación, y por lo mismo: esto escribe en la
    // planilla que mira la planta. Si el tope viviera en dos lugares, uno de
    // los dos se quedaría viejo.
    if (!Number.isInteger(dias) || dias <= 0 || dias > MAXIMO_DE_DIAS) {
      return NextResponse.json(
        { error: `Los días tienen que ser un entero de 1 a ${MAXIMO_DE_DIAS}` },
        { status: 400 }
      );
    }
    update.dias = dias;
  }

  if (body.activa !== undefined) update.activa = Boolean(body.activa);

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No se envió ningún cambio" }, { status: 400 });
  }

  const { data, error } = await createAdminClient()
    .from("mant_razones_de_postergacion")
    .update(update)
    .eq("codigo", codigo)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "No existe esa razón" }, { status: 404 });

  return NextResponse.json({ data });
}
