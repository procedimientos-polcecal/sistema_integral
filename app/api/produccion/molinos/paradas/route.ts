import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { puedeEditarProduccion } from "@/lib/produccion/auth";
import { puedeVerMantenimiento } from "@/lib/mantenimiento/auth";
import { AltaDeParada, BajaDeParada, EdicionDeParada } from "@/lib/produccion/molinos/paradas";

/**
 * El motivo de una parada de molino: lo único de este módulo que escribe una
 * persona. Lo demás sale del PC Robot.
 *
 *   POST    alta. `turno` null = "planta parada": el día entero de ese molino.
 *   PATCH   edición del motivo y, si se manda, del enlace a la OT.
 *   DELETE  quita una parada (un día entero marcado por error taparía cuatro
 *           turnos sin otra salida).
 *
 * Se escribe con la sesión de quien llama y no con el cliente admin: la policy
 * `puede_editar_produccion()` de la tabla hace de segunda llave, y el permiso
 * se comprueba además acá para contestar un 403 que diga qué falta.
 *
 * **El enlace a una OT exige acceso a Mantenimiento.** Las tablas de ese módulo
 * están cerradas con su propia función, así que quien no lo tiene no ve ni una
 * OT —la lista le llega vacía y sin error— y no puede haber elegido ninguna: un
 * `orden_trabajo_id` que llegue de su sesión sólo puede venir de afuera de la
 * pantalla. Y la OT la **elige una persona de una lista**: acá no se adivina ni
 * se completa por texto, porque enlazar a la que se le parece es peor que
 * dejar el enlace en null.
 */

type Rechazo = NextResponse | null;

async function sesionConEdicion(): Promise<
  { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string } | { ok: false; res: NextResponse }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, res: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!(await puedeEditarProduccion(supabase, user.id))) {
    return {
      ok: false,
      res: NextResponse.json({ error: "Tu usuario no tiene nivel de edición en Producción" }, { status: 403 }),
    };
  }
  return { ok: true, supabase, userId: user.id };
}

async function exigirMantenimientoSiHayOt(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  orden: string | null | undefined,
): Promise<Rechazo> {
  if (orden === undefined) return null; // no se toca el enlace
  if (await puedeVerMantenimiento(supabase, userId)) return null;
  return NextResponse.json(
    { error: "No tenés acceso a Mantenimiento: no podés enlazar ni quitar una orden de trabajo." },
    { status: 403 },
  );
}

/** Lo que Postgres dice cuando falla una clave foránea o la unicidad, dicho en castellano. */
function errorDeLaBase(error: { code?: string; message: string }): NextResponse {
  if (error.code === "23505") {
    return NextResponse.json(
      { error: "Ese turno ya tiene un motivo cargado: recargá la pantalla para verlo." },
      { status: 409 },
    );
  }
  if (error.code === "23503") {
    return NextResponse.json({ error: "El molino o la orden de trabajo no existe." }, { status: 400 });
  }
  return NextResponse.json({ error: error.message }, { status: 500 });
}

export async function POST(request: Request) {
  const s = await sesionConEdicion();
  if (!s.ok) return s.res;

  const v = validar(AltaDeParada, await cuerpoJson(request));
  if (!v.ok) return errorDeValidacion(v.problemas);
  const { molino_id, fecha, turno, motivo, orden_trabajo_id } = v.datos;

  const rechazo = await exigirMantenimientoSiHayOt(s.supabase, s.userId, orden_trabajo_id);
  if (rechazo) return rechazo;

  // El enlace se escribe sólo si vino: ausente y null no son lo mismo.
  const fila = {
    molino_id,
    fecha,
    turno,
    motivo,
    creado_por: s.userId,
    ...(orden_trabajo_id !== undefined ? { orden_trabajo_id } : {}),
  };
  const { data, error } = await s.supabase
    .from("produccion_molino_paradas")
    .insert(fila)
    .select("id, molino_id, fecha, turno, motivo, orden_trabajo_id")
    .single();
  if (error) return errorDeLaBase(error);
  return NextResponse.json({ parada: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const s = await sesionConEdicion();
  if (!s.ok) return s.res;

  const v = validar(EdicionDeParada, await cuerpoJson(request));
  if (!v.ok) return errorDeValidacion(v.problemas);
  const { id, motivo, orden_trabajo_id } = v.datos;

  const rechazo = await exigirMantenimientoSiHayOt(s.supabase, s.userId, orden_trabajo_id);
  if (rechazo) return rechazo;

  const cambios = { motivo, ...(orden_trabajo_id !== undefined ? { orden_trabajo_id } : {}) };
  const { data, error } = await s.supabase
    .from("produccion_molino_paradas")
    .update(cambios)
    .eq("id", id)
    .select("id, molino_id, fecha, turno, motivo, orden_trabajo_id");
  if (error) return errorDeLaBase(error);
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Esa parada no existe: puede que otra persona la haya quitado." }, { status: 404 });
  }
  return NextResponse.json({ parada: data[0] });
}

export async function DELETE(request: Request) {
  const s = await sesionConEdicion();
  if (!s.ok) return s.res;

  const v = validar(BajaDeParada, await cuerpoJson(request));
  if (!v.ok) return errorDeValidacion(v.problemas);

  const { data, error } = await s.supabase
    .from("produccion_molino_paradas")
    .delete()
    .eq("id", v.datos.id)
    .select("id");
  if (error) return errorDeLaBase(error);
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Esa parada no existe: puede que otra persona la haya quitado." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
