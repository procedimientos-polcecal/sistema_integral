import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check, puede_editar_check } from "@/lib/rrhh/route-utils";
import { recalcularEmpleadoPeriodo } from "@/lib/rrhh/engine/recalcular";
import { localDateTime, toUtcDateOnly } from "@/lib/rrhh/dates";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { marcarDiaCorregido } from "@/lib/rrhh/fichadas/marcarDia";
import { conCalculoDelDia } from "@/lib/rrhh/fichadas/calculoDelDia";
import { traerTodo } from "@/lib/core/paginado";

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

  // `traerTodo` y no un `.limit(500)`: la pantalla ahora pide un rango de días
  // entero, y una semana de toda la planta son unas 450 filas — el tope de
  // antes estaba a un día de quedarse corto. PostgREST además corta en 1000 y
  // no avisa, así que un tope más alto tampoco habría alcanzado: lo que se
  // vería es un día recortado por la mitad, sin ningún indicio.
  //
  // El `.order("id")` después del de fecha NO es decorativo: `.range()` es
  // LIMIT/OFFSET y `fecha` se repite decenas de veces, así que sin un
  // desempate dos tandas consecutivas pueden repetir o saltear filas.
  let data: { empleado_id: string; fecha: string }[];
  try {
    data = await traerTodo((d, h) => {
      let q = supabase.from("fichadas").select("*, empleados(id, legajo, nombre, apellido)");
      if (employeeId) q = q.eq("empleado_id", employeeId);
      if (desde) q = q.gte("fecha", desde);
      if (hasta) q = q.lte("fecha", hasta);
      return q.order("fecha", { ascending: false }).order("id").range(d, h);
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  // Con el cálculo del día pegado, igual que la página: el refresco de la lista
  // tiene que traer lo mismo que la carga inicial (ver conCalculoDelDia).
  return NextResponse.json(await conCalculoDelDia(supabase, data ?? []));
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
  const protegido = await marcarDiaCorregido(supabase, fichada.empleado_id, fichada.fecha, user.id, "creada");

  await recalcularEmpleadoPeriodo(supabase, employeeId, new Date(fecha), new Date(fecha));
  // La fichada se creó, así que no es un error: pero si el día no quedó marcado
  // el cron lo va a pisar, y la persona tiene que enterarse. El campo viaja
  // sólo cuando falla.
  return NextResponse.json(protegido ? fichada : { ...fichada, diaSinProteger: true }, { status: 201 });
}
