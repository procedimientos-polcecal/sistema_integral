import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/remises/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { z } from "zod";
import { validar, errorDeValidacion } from "@/lib/core/validar";

/*
 * Antes esta ruta no devolvía un solo 400. Ver `lib/core/validar.ts`.
 *
 * La hora va con forma `HH:MM` y no un texto cualquiera: es lo que después se
 * imprime en la hoja de ruta y lo que ordena las salidas. Un `"a la tarde"`
 * entraba y rompía el orden sin decir nada.
 */
const Cuerpo = z.object({
  horaSalida: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "La hora de salida va como HH:MM.")
    .nullable()
    .optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const validado = validar(Cuerpo, await cuerpoJson(request));
  if (!validado.ok) return errorDeValidacion(validado.problemas);
  const body = validado.datos;

  const data: Record<string, unknown> = {};
  if (body.horaSalida !== undefined) data.hora_salida = body.horaSalida || null;

  const { data: hoja, error } = await supabase.from("hojas_ruta").update(data).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(hoja);
}

/** Quitar el vehículo de la ruta calculada (borra la hoja; sus asientos quedan sin ruta para esta generación). */
export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const { error } = await supabase.from("hojas_ruta").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
