import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check, puede_editar_check } from "@/lib/rrhh/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { altaDeAusencia } from "@/lib/rrhh/altaDeAusencia";
import { datosDeAusenciaDeVacaciones, rangoAlReves } from "@/lib/rrhh/periodoDeVacaciones";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const employeeId = url.searchParams.get("employeeId");

  let query = supabase
    .from("vacaciones")
    .select("*, empleados(id, legajo, nombre, apellido)")
    .order("fecha_desde", { ascending: false });
  if (employeeId) query = query.eq("empleado_id", employeeId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/**
 * Cargar un período de vacaciones **crea una ausencia**, y el período nace de
 * ella.
 *
 * Esta ruta insertaba derecho en `vacaciones`. El problema es que
 * `/disponibilidad` —y la programación del taller, y los tres reportes de
 * ausentismo— leen `ausencias` y nada más: una fila de `vacaciones` sin
 * ausencia **no existe** para ninguno de los tres. Medido el 16/11/2026: de 41
 * períodos, **20 eran así**, y 4 de ellos tocaban ese día o uno futuro, o sea
 * que había gente de vacaciones que la pantalla mostraba como presente.
 *
 * Ahora el alta pasa por `altaDeAusencia()` —el mismo cuerpo que usa RRHH →
 * Ausencias y la punta del taller— y `sincronizarPeriodoVacaciones()`, que ese
 * cuerpo llama por dentro, escribe la fila de `vacaciones` con su
 * `ausencia_id`. El arreglo vive en la ruta y no en la pantalla a propósito:
 * así lo heredan las dos que postean acá —Balance por empleado y la ficha del
 * empleado— y cualquier tercera que aparezca mañana.
 *
 * `recalcularEmpleadoPeriodo` ya no se llama acá: lo hace `altaDeAusencia` por
 * dentro, **después** de crear el período, que es el orden que da el resultado
 * correcto. Llamarla también acá la corría dos veces.
 *
 * Diseño: `docs/superpowers/specs/2026-11-16-vacaciones-en-disponibilidad-design.md`.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const { employeeId, fechaDesde, fechaHasta } = body;
  // `diasTomados` ya no se pide: desde el 16/11/2026 ese número sale siempre
  // del calendario, y lo escribe la sincronización.
  if (!employeeId || !fechaDesde || !fechaHasta) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  if (rangoAlReves(fechaDesde, fechaHasta)) {
    return NextResponse.json(
      { error: "La fecha hasta no puede ser anterior a la fecha desde" },
      { status: 400 }
    );
  }

  const { data: { user } } = await supabase.auth.getUser();

  // Los errores salen tal cual: son los mensajes en castellano que ya conoce
  // quien usa RRHH, incluido el de «Para Vacaciones hay que indicar a qué año
  // corresponden los días» — que antes esta ruta se tapaba poniendo el año en
  // curso por defecto, y descontaba del balance equivocado sin decir nada.
  const { ausencia, error, status } = await altaDeAusencia(
    supabase,
    datosDeAusenciaDeVacaciones(body, user!.id)
  );
  if (error) return NextResponse.json({ error }, { status: status ?? 500 });

  const { data: periodo, error: errorPeriodo } = await supabase
    .from("vacaciones")
    .select("*")
    .eq("ausencia_id", (ausencia as { id: string }).id)
    .single();
  if (errorPeriodo) return NextResponse.json({ error: errorPeriodo.message }, { status: 500 });

  return NextResponse.json(periodo, { status: 201 });
}
