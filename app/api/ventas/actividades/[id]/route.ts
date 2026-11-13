import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { esAdminVentas, noSePudoAveriguar, puedeEditarVentas } from "@/lib/ventas/auth";
import { esquemaDeActividadParcial, problemaDelProximoPaso } from "@/lib/ventas/crm/cuerpos";
import { validar, errorDeValidacion } from "@/lib/core/validar";

/**
 * Una actividad: corregirla o dar por cumplido su próximo paso (PATCH), y
 * borrarla (DELETE).
 *
 * ── CUMPLIR NO BORRA EL PRÓXIMO PASO ────────────────────────
 *
 * Se escribe `cumplido_el` y el texto queda. «Qué había que hacer y cuándo se
 * hizo» es justamente lo que se quiere leer después; vaciar el campo al
 * cumplirlo dejaría una fila que dice que alguien hizo algo sin decir qué.
 *
 * ── LA REGLA DE LOS DOS CAMPOS SE MIRA SOBRE EL RESULTADO ───
 *
 * `problemaDelProximoPaso` recibe lo que va a quedar, fusionando lo que vino
 * con lo que ya estaba. Mirarlo sólo sobre el cuerpo dejaría pasar un PATCH que
 * borra la fecha y deja el texto huérfano —la tabla lo frenaría con un 23514
 * que no dice nada— y otro que pone fecha sin texto.
 *
 * ── CUALQUIERA DEL EQUIPO PUEDE CORREGIR LA DE OTRO ─────────
 *
 * A propósito, y es la única cosa del módulo donde se eligió lo abierto sobre
 * lo cerrado: a una visita van dos, y marcar cumplido el paso que hizo alguien
 * que se tomó licencia es lo normal. Lo que no se puede es **firmarla** a
 * nombre de otro: `hecha_por` no está entre los campos corregibles y la policy
 * de insert lo exige del otro lado.
 */

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ES_UUID.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await puedeEditarVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) {
    return NextResponse.json(
      { error: "No tenés permiso para corregir actividades" },
      { status: 403 }
    );
  }

  const r = validar(esquemaDeActividadParcial, await request.json().catch(() => null));
  if (!r.ok) return errorDeValidacion(r.problemas);
  const a = r.datos;

  const cambios: Record<string, unknown> = {};
  for (const campo of [
    "contacto_id",
    "oportunidad_id",
    "tipo",
    "fecha",
    "resumen",
    "proximo_paso",
    "proximo_paso_el",
    "cumplido_el",
  ] as const) {
    if (campo in a) cambios[campo] = a[campo] ?? null;
  }

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No mandaste ningún cambio" }, { status: 400 });
  }

  const { data: actual, error: errorDeLectura } = await supabase
    .from("ventas_actividades")
    .select("id, proximo_paso, proximo_paso_el")
    .eq("id", id)
    .maybeSingle();
  if (errorDeLectura) {
    return NextResponse.json(
      { error: `No se pudo leer la actividad: ${errorDeLectura.message}` },
      { status: 503 }
    );
  }
  if (!actual) return NextResponse.json({ error: "No existe esa actividad" }, { status: 404 });

  // Sobre lo que va a quedar, no sobre lo que vino. Ver el encabezado.
  const pasoResultante =
    "proximo_paso" in cambios ? (cambios.proximo_paso as string | null) : actual.proximo_paso;
  const fechaResultante =
    "proximo_paso_el" in cambios
      ? (cambios.proximo_paso_el as string | null)
      : actual.proximo_paso_el;

  const problema = problemaDelProximoPaso(pasoResultante, fechaResultante);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });

  const { data, error } = await supabase
    .from("ventas_actividades")
    .update(cambios)
    .eq("id", id)
    .select(
      "id, cliente_id, contacto_id, oportunidad_id, tipo, fecha, resumen, proximo_paso, proximo_paso_el, cumplido_el, hecha_por, creada_en"
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: `No se pudo guardar el cambio: ${error.message}` },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "No existe esa actividad o no podés tocarla" },
      { status: 404 }
    );
  }

  return NextResponse.json({ actividad: data });
}

/**
 * Borrar es de `admin` y el camino normal para una cargada mal es corregirla.
 *
 * No se audita: el registro de una actividad es lo que alguien escribió sobre
 * una conversación, y borrarlo no deja un hueco en ningún número ni escribe
 * nada afuera. Lo que sí deja un hueco —borrar el cliente entero, que se lleva
 * todas sus actividades— se audita en su ruta.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ES_UUID.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await esAdminVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) {
    return NextResponse.json(
      {
        error:
          "Borrar una actividad requiere nivel admin en Ventas. " +
          "Si quedó mal cargada, lo que corresponde es corregirla.",
      },
      { status: 403 }
    );
  }

  const { error } = await supabase.from("ventas_actividades").delete().eq("id", id);
  if (error) {
    return NextResponse.json(
      { error: `No se pudo borrar la actividad: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
