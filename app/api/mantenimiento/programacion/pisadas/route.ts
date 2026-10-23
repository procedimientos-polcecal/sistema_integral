import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminMantenimiento } from "@/lib/mantenimiento/auth";

/**
 * Las pisadas: lo que el encargado movió a mano, por persona y por día.
 *
 * `POST` escribe `(empleado_id, dia, turno)` y, si esa persona ya tenía una ese
 * día, la reemplaza: el `unique (empleado_id, dia)` es un índice único completo
 * —no parcial— y por eso sirve como destino del `ON CONFLICT`. Es también lo
 * que impide que alguien quede en dos turnos a la vez.
 *
 * `DELETE` la saca y ese día vuelve al ciclo.
 */

const TURNOS = ["4-12", "8-16", "12-20"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una fecha "YYYY-MM-DD" que existe en el calendario. */
function esFechaIso(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [a, m, d] = v.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

async function admitir() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  if (!(await esAdminMantenimiento(supabase, user.id))) {
    return {
      error: NextResponse.json(
        { error: "Mover gente de turno requiere ser admin de Mantenimiento" },
        { status: 403 }
      ),
    };
  }
  return { user };
}

/** POST — mover a una persona a un turno en un día. */
export async function POST(request: Request) {
  const permiso = await admitir();
  if (permiso.error) return permiso.error;

  const b = await request.json().catch(() => null);
  const empleadoId = String(b?.empleadoId ?? "");
  const dia = b?.dia;
  const turno = String(b?.turno ?? "");

  const problemas: string[] = [];
  if (!UUID.test(empleadoId)) problemas.push("Falta elegir la persona");
  if (!esFechaIso(dia)) problemas.push("Falta el día, en formato AAAA-MM-DD");
  if (!TURNOS.includes(turno)) problemas.push("El turno tiene que ser 4-12, 8-16 o 12-20");
  if (problemas.length) return NextResponse.json({ error: problemas.join(". ") }, { status: 400 });

  const db = createAdminClient();

  // Mover a alguien que ese día no es del taller dejaría una pisada que la
  // pantalla no sabe mostrar: la semana sólo recorre el padrón vigente.
  const { data: vigentes, error: errPadron } = await db
    .from("mant_personal_taller")
    .select("id")
    .eq("empleado_id", empleadoId)
    .lte("desde", dia as string)
    .or(`hasta.is.null,hasta.gte.${dia}`)
    .limit(1);
  if (errPadron) return NextResponse.json({ error: errPadron.message }, { status: 500 });
  if (!vigentes?.length) {
    return NextResponse.json({ error: "Esa persona no es del taller ese día" }, { status: 400 });
  }

  const { data, error } = await db
    .from("mant_programacion_pisadas")
    .upsert(
      { empleado_id: empleadoId, dia: dia as string, turno, pisado_por_id: permiso.user.id },
      { onConflict: "empleado_id,dia" }
    )
    .select("empleado_id, dia, turno")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

/** DELETE ?empleadoId=&dia= — sacar la pisada: ese día vuelve al ciclo. */
export async function DELETE(request: Request) {
  const permiso = await admitir();
  if (permiso.error) return permiso.error;

  const params = new URL(request.url).searchParams;
  const empleadoId = params.get("empleadoId") ?? "";
  const dia = params.get("dia");

  if (!UUID.test(empleadoId)) return NextResponse.json({ error: "Falta elegir la persona" }, { status: 400 });
  if (!esFechaIso(dia)) return NextResponse.json({ error: "Falta el día, en formato AAAA-MM-DD" }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("mant_programacion_pisadas")
    .delete()
    .eq("empleado_id", empleadoId)
    .eq("dia", dia)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Se dice cuántas filas se sacaron: una pantalla desactualizada que borra una
  // pisada que otro ya había sacado no debe recibir lo mismo que una baja real.
  const borradas = data?.length ?? 0;
  return NextResponse.json({ ok: true, borradas });
}
