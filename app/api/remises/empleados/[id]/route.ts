import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/remises/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { z } from "zod";
import { validar, errorDeValidacion } from "@/lib/core/validar";

/*
 * Antes esta ruta no devolvía un solo 400. Ver `lib/core/validar.ts`.
 *
 * `lat` y `lng` llevan rango: una coordenada fuera de [-90,90] / [-180,180] no
 * es un error de tipo, Postgres la acepta, y lo que se rompe después es el
 * ruteo del remis — que calcula distancias contra un punto que no existe.
 */
const Cuerpo = z.object({
  direccion: z.string().nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  turnoDefaultId: z.uuid().nullable().optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const validado = validar(Cuerpo, await cuerpoJson(request));
  if (!validado.ok) return errorDeValidacion(validado.problemas);
  const body = validado.datos;

  const data: Record<string, unknown> = { empleado_id: id };
  if (body.direccion !== undefined) data.direccion = body.direccion?.trim() || null;
  if (body.lat !== undefined) data.lat = body.lat;
  if (body.lng !== undefined) data.lng = body.lng;
  if (body.turnoDefaultId !== undefined) data.turno_default_id = body.turnoDefaultId || null;

  const { data: fila, error } = await supabase
    .from("remises_empleados_datos")
    .upsert(data, { onConflict: "empleado_id" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(fila);
}
