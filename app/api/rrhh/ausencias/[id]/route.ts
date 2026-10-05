import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/rrhh/route-utils";
import { recalcularEmpleadoPeriodo } from "@/lib/rrhh/engine/recalcular";
import { sincronizarPeriodoVacaciones } from "@/lib/rrhh/vacacionesDeAusencia";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { z } from "zod";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { TIPOS_AUSENCIA } from "@/lib/rrhh/tiposAusencia";

/*
 * Antes esta ruta no devolvía un solo 400: lo que llegara iba derecho a
 * Postgres, que rechaza un `fecha_desde: 42` con `invalid input syntax for type
 * date` — un mensaje que llega a la pantalla sin decir qué campo ni qué se
 * esperaba. Ver `lib/core/validar.ts`.
 *
 * Todo opcional porque es un PUT parcial: lo que no viene no se toca, que es lo
 * que ya hacía la lista blanca de abajo. Lo que cambia es que lo que SÍ viene
 * ahora tiene que tener la forma correcta.
 *
 * Los tipos salen de `TIPOS_AUSENCIA`, la misma lista que llena el desplegable:
 * una copia acá sería la que se olvida de actualizar.
 */
const Cuerpo = z.object({
  employeeId: z.uuid().optional(),
  fechaDesde: z.iso.date().optional(),
  fechaHasta: z.iso.date().optional(),
  tipo: z.enum(TIPOS_AUSENCIA.map(([v]) => v) as [string, ...string[]]).optional(),
  justificada: z.boolean().optional(),
  observaciones: z.string().nullable().optional(),
  anioCorrespondiente: z.number().int().optional(),
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
  if (body.employeeId !== undefined) data.empleado_id = body.employeeId;
  if (body.fechaDesde !== undefined) data.fecha_desde = body.fechaDesde;
  if (body.fechaHasta !== undefined) data.fecha_hasta = body.fechaHasta;
  if (body.tipo !== undefined) data.tipo = body.tipo;
  if (body.justificada !== undefined) data.justificada = body.justificada;
  if (body.observaciones !== undefined) data.observaciones = body.observaciones || null;

  const { data: ausencia, error } = await supabase.from("ausencias").update(data).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sincronizarPeriodoVacaciones(supabase, ausencia, body.anioCorrespondiente);
  await recalcularEmpleadoPeriodo(supabase, ausencia.empleado_id, new Date(ausencia.fecha_desde), new Date(ausencia.fecha_hasta));
  return NextResponse.json(ausencia);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const { data: ausencia, error } = await supabase.from("ausencias").delete().eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recalcularEmpleadoPeriodo(supabase, ausencia.empleado_id, new Date(ausencia.fecha_desde), new Date(ausencia.fecha_hasta));
  return new NextResponse(null, { status: 204 });
}
