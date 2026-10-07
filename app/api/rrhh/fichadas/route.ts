import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check, puede_editar_check } from "@/lib/rrhh/route-utils";
import { recalcularEmpleadoPeriodo } from "@/lib/rrhh/engine/recalcular";
import { localDateTime, toUtcDateOnly } from "@/lib/rrhh/dates";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { marcarDiaCorregido } from "@/lib/rrhh/fichadas/marcarDia";

// El frontend manda la hora como "YYYY-MM-DDTHH:MM:SS" sin zona horaria (hora
// de pared en Argentina) — se parsea a mano con localDateTime(), que siempre
// asume Argentina sin importar el huso del server (ver lib/rrhh/dates.ts).
function parseHoraDePared(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, y, m, d, h, mi, s] = match;
  const fecha = toUtcDateOnly(Number(y), Number(m) - 1, Number(d));
  return localDateTime(fecha, Number(h), Number(mi), s ? Number(s) : 0);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const employeeId = url.searchParams.get("employeeId");
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");

  let query = supabase
    .from("fichadas")
    .select("*, empleados(id, legajo, nombre, apellido)")
    .order("fecha", { ascending: false })
    .limit(500);
  if (employeeId) query = query.eq("empleado_id", employeeId);
  if (desde) query = query.gte("fecha", desde);
  if (hasta) query = query.lte("fecha", hasta);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  // Antes de escribir y no después: si faltara, se corta acá y no con la
  // fichada ya guardada y el día sin marcar. `puede_editar_check` ya pasó, así
  // que no debería pasar nunca; sólo evita un `!` que explotaría tarde.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await cuerpoJson(request);
  const { employeeId, fecha, horaEntrada, horaSalida, observaciones } = body;
  const entrada = parseHoraDePared(horaEntrada);
  if (!employeeId || !fecha || !entrada) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const salida = horaSalida ? parseHoraDePared(horaSalida) : null;

  const { data: fichada, error } = await supabase
    .from("fichadas")
    .insert({
      empleado_id: employeeId,
      fecha,
      hora_entrada: entrada.toISOString(),
      hora_salida: salida ? salida.toISOString() : null,
      origen: "MANUAL",
      observaciones: observaciones || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Con lo que devolvió la base y no con el cuerpo: `fichada.fecha` es el
  // "YYYY-MM-DD" de la columna `date`, venga como venga lo que mandó el cliente.
  await marcarDiaCorregido(supabase, fichada.empleado_id, fichada.fecha, user.id, "creada");

  await recalcularEmpleadoPeriodo(supabase, employeeId, new Date(fecha), new Date(fecha));
  return NextResponse.json(fichada, { status: 201 });
}
