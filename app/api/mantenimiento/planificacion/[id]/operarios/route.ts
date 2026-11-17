import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { TURNOS_DEL_PARTE, type TurnoDelParte } from "@/lib/mantenimiento/operariosDelParte";

/**
 * Quiénes trabajaron en una hoja del parte diario.
 *
 * SE GUARDA DE A UNO, NO SE REEMPLAZA LA LISTA ENTERA. La pantalla suma y saca
 * personas de a una, y la ruta hace exactamente eso: un `POST` agrega, un
 * `DELETE` saca. Un `PUT` que reemplace el conjunto entero haría que dos
 * personas editando la misma hoja se pisen —la última en guardar borraría lo
 * que la otra acababa de sumar— y acá no hay nada que lo frene.
 *
 * LA CLAVE ES (plan, turno, empleado), así que la hoja de 4 a 12 y la de 12 a
 * 20 del mismo plan son dos conjuntos distintos y `todo_el_dia` es un tercero.
 * El porqué está en el encabezado de la migración `20261113080216`.
 *
 * El permiso es el mismo que el de la planificación: nivel de edición en
 * Mantenimiento. Para leer alcanza con la sesión, como el resto del plan.
 */

type Params = { params: Promise<{ id: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const esTurnoDelParte = (v: unknown): v is TurnoDelParte =>
  typeof v === "string" && (TURNOS_DEL_PARTE as readonly string[]).includes(v);

async function editor() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return { error: NextResponse.json({ error: "Sin permisos" }, { status: 403 }) };
  }
  return { supabase, user };
}

/** GET `?turno=` — los operarios guardados de esa hoja, con su nombre. */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const turno = new URL(request.url).searchParams.get("turno");
  if (!esTurnoDelParte(turno)) {
    return NextResponse.json({ error: "El turno tiene que ser 4_12, 12_20 o todo_el_dia" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("planificacion_diaria_operarios")
    .select("empleado_id, empleados(nombre, apellido)")
    .eq("plan_id", id)
    .eq("turno", turno);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data: (data ?? []).map((f) => {
      const e = Array.isArray(f.empleados) ? f.empleados[0] : f.empleados;
      return {
        empleadoId: f.empleado_id as string,
        nombre: e ? `${e.apellido}, ${e.nombre}` : "(sin nombre)",
      };
    }),
  });
}

/** POST — suma una persona a esa hoja. */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const permiso = await editor();
  if (permiso.error) return permiso.error;

  const { turno, empleadoId } = await cuerpoJson(request);
  const problemas: string[] = [];
  if (!esTurnoDelParte(turno)) problemas.push("El turno tiene que ser 4_12, 12_20 o todo_el_dia");
  if (!UUID.test(String(empleadoId ?? ""))) problemas.push("Falta elegir la persona");
  if (problemas.length) return NextResponse.json({ error: problemas.join(". ") }, { status: 400 });

  /*
   * `upsert` y no `insert`: sumar a alguien que ya está no es un error que
   * valga la pena contarle a nadie —la pantalla ya lo muestra adentro—, y un
   * 409 por apretar dos veces sólo genera un cartel que se cierra. La
   * constraint única existe igual y es la que lo vuelve idempotente.
   */
  const { error } = await permiso.supabase!
    .from("planificacion_diaria_operarios")
    .upsert(
      { plan_id: id, turno, empleado_id: empleadoId, creado_por: permiso.user!.id },
      { onConflict: "plan_id,turno,empleado_id" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}

/** DELETE `?turno=&empleadoId=` — saca una persona de esa hoja. */
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const permiso = await editor();
  if (permiso.error) return permiso.error;

  const url = new URL(request.url);
  const turno = url.searchParams.get("turno");
  const empleadoId = url.searchParams.get("empleadoId") ?? "";
  if (!esTurnoDelParte(turno) || !UUID.test(empleadoId)) {
    return NextResponse.json({ error: "Falta el turno o la persona que se saca" }, { status: 400 });
  }

  /*
   * Esto NO se audita, a diferencia de sacar a alguien del padrón del taller.
   * La diferencia es qué queda si uno se equivoca: acá se vuelve a agregar con
   * un clic y la hoja todavía no se imprimió. Lo que se audita es lo que no se
   * puede rehacer.
   */
  const { error } = await permiso.supabase!
    .from("planificacion_diaria_operarios")
    .delete()
    .eq("plan_id", id)
    .eq("turno", turno)
    .eq("empleado_id", empleadoId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
