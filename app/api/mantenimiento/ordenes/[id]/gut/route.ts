import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { esquemaGut } from "@/lib/mantenimiento/gut";
import { validar, errorDeValidacion } from "@/lib/core/validar";

/**
 * Las tres notas GUT de una orden de trabajo que ya existe.
 *
 * Es el camino que más se usa: de las 2.227 órdenes, 2.209 entraron por el
 * formulario de Google y llegan sin puntuar, así que casi todo el GUT se carga
 * acá, después, y no al crear la orden. El diseño está en
 * docs/superpowers/specs/2026-10-21-mantenimiento-gut-design.md.
 *
 * CADA NOTA QUE VIENE SE ESCRIBE, Y LA QUE NO VIENE NO SE TOCA
 *
 * Un `null` borra la nota; una clave ausente la deja como estaba. Así se puede
 * corregir una sola sin reenviar las otras dos. El esquema no exige las tres
 * (alguien puede estar a mitad de camino), pero un cuerpo sin ninguna nota no
 * tiene nada que guardar y se contesta 400 en vez de un `update` vacío.
 *
 * POR QUÉ NO HAY ESCRITURA A LA PLANILLA
 *
 * Esta ruta no llama a `escribirEnLaFilaDeLaOT`, y es a propósito. El GUT no se
 * exporta: `prioridad` es una columna de la planilla y forma parte de un derrame
 * de `IMPORTRANGE`, de modo que escribir ahí un puntaje del sistema pisaría una
 * región que calcula la propia hoja. Por eso el puntaje vive en columnas
 * propias de `ordenes_trabajo` y la planilla ni se entera. Si alguna vez se lo
 * exporta, es una decisión de diseño nueva y no un renglón que se agrega acá.
 *
 * POR QUÉ NO HAY AUDITORÍA
 *
 * Tampoco llama a `auditar()`. La regla del núcleo es auditar lo que no se
 * deshace, y un puntaje sí se deshace: se corrige escribiendo otro. No es una
 * acción irreversible, así que no entra en esa tabla.
 */

type Params = { params: Promise<{ id: string }> };

const CAMPOS = ["gut_gravedad", "gut_urgencia", "gut_tendencia"] as const;

/** PATCH — guardar las notas GUT de la orden. */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Puntuar una OT requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const validado = validar(esquemaGut, body);
  if (!validado.ok) return errorDeValidacion(validado.problemas);

  // Sólo las notas que vinieron: `undefined` es "no la toques", `null` es
  // "borrala". El esquema ya garantizó que el resto son enteros de 1 a 5.
  const cambios: Partial<Record<(typeof CAMPOS)[number], number | null>> = {};
  for (const campo of CAMPOS) {
    const valor = validado.datos[campo];
    if (valor !== undefined) cambios[campo] = valor;
  }
  if (Object.keys(cambios).length === 0) {
    return NextResponse.json(
      { error: "No hay ninguna nota para guardar: mandá gut_gravedad, gut_urgencia o gut_tendencia." },
      { status: 400 }
    );
  }

  // `select("id")` y no un `update` pelado: con cero filas afectadas PostgREST
  // contesta 204 sin error, y un id inventado pasaría por guardado.
  const { data, error } = await createAdminClient()
    .from("ordenes_trabajo")
    .update(cambios)
    .eq("id", id)
    .select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data?.length) {
    return NextResponse.json({ error: "No existe esa orden de trabajo" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
