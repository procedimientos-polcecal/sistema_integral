import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/rrhh/route-utils";
import { recalcularEmpleadoPeriodo } from "@/lib/rrhh/engine/recalcular";
import { sincronizarPeriodoVacaciones } from "@/lib/rrhh/vacacionesDeAusencia";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { auditar, nombreParaAuditoria } from "@/lib/core/auditoria";
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

/**
 * Una ausencia en una línea, para el registro: lo que decía, no sólo que pasó algo.
 *
 * Es gemela de la de `app/api/mantenimiento/ausencias/route.ts`, que es la otra
 * punta que toca esta tabla. Están separadas a propósito: la de allá vive en una
 * ruta de Mantenimiento, y mudar las dos a `lib/` sería meter mano en un archivo
 * de RRHH más allá de agregarle el registro, que es lo único que este cambio
 * viene a hacer.
 */
function comoSeLee(a: {
  tipo: unknown;
  fecha_desde: unknown;
  fecha_hasta: unknown;
  justificada: unknown;
  observaciones: unknown;
}): string {
  const dia = (v: unknown) => String(v ?? "").slice(0, 10);
  const obs = typeof a.observaciones === "string" && a.observaciones.trim() ? ` — ${a.observaciones.trim()}` : "";
  const sinJustificar = a.justificada ? "" : " (sin justificar)";
  return `${String(a.tipo)} del ${dia(a.fecha_desde)} al ${dia(a.fecha_hasta)}${sinJustificar}${obs}`;
}

/**
 * El registro de auditoría de esta ruta, que va **antes** del cambio: si no
 * entra, el cambio no se hace.
 *
 * Corregir o borrar una ausencia **pierde lo que había**: no hay historial de
 * `ausencias`, y `recalcularEmpleadoPeriodo` rehace `calculos_diarios` sobre las
 * fechas nuevas, así que los días de los que la ausencia se fue vuelven a verse
 * como si nunca hubiera pasado nada. Es el mismo orden que `borradoDeEspejo`
 * fijó para los borrados, y por la misma razón.
 *
 * Esta ruta no auditaba nada. La punta de Mantenimiento —el encargado del taller
 * anotando la falta de uno de los suyos— sí, desde el 26/10/2026; auditar una
 * sola de las dos haría creer que la tabla tiene el registro de los borrados de
 * ausencias cuando tendría el de la mitad.
 *
 * Devuelve la respuesta de error, o null si quedó registrado.
 */
async function problemaDeAuditoria(
  supabase: SupabaseClient,
  accion: "corregir" | "borrar",
  anterior: {
    id: string;
    empleado_id: string;
    fecha_desde: unknown;
    fecha_hasta: unknown;
    tipo: unknown;
    justificada: unknown;
    observaciones: unknown;
  },
  valorNuevo: string | null
): Promise<NextResponse | null> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: quien } = user
    ? await supabase.from("usuarios").select("nombre, apellido, email").eq("id", user.id).maybeSingle()
    : { data: null };

  const registro = await auditar(supabase, {
    modulo: "rrhh",
    entidad: "ausencias",
    entidadId: anterior.id,
    accion,
    usuario: user ? { id: user.id, nombre: nombreParaAuditoria(quien) } : null,
    valorAnterior: comoSeLee(anterior),
    valorNuevo,
    contexto: {
      ruta: "rrhh/ausencias",
      empleado_id: anterior.empleado_id,
      anterior: {
        fecha_desde: String(anterior.fecha_desde ?? "").slice(0, 10),
        fecha_hasta: String(anterior.fecha_hasta ?? "").slice(0, 10),
        tipo: String(anterior.tipo),
        justificada: Boolean(anterior.justificada),
        observaciones: typeof anterior.observaciones === "string" ? anterior.observaciones : null,
      },
    },
  });

  if (!registro.ok) {
    const que = accion === "borrar" ? "el borrado" : "la corrección";
    const y = accion === "borrar" ? "no se borró" : "no se cambió nada";
    return NextResponse.json(
      { error: `No se pudo registrar ${que} en la auditoría, así que ${y}: ${registro.error}` },
      { status: 500 }
    );
  }
  return null;
}

/** La fila como está hoy, para el registro y para saber si existe. */
async function laAusencia(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase
    .from("ausencias")
    .select("id, empleado_id, fecha_desde, fecha_hasta, tipo, justificada, observaciones")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!data) return { error: NextResponse.json({ error: "Esa ausencia no existe" }, { status: 404 }) };
  return { ausencia: data };
}

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

  /*
   * Un PUT que no cambia nada no se escribe.
   *
   * Todos los campos del `Cuerpo` son opcionales porque esto es un PUT parcial,
   * así que un `{}` llegaba hasta acá con `data` vacío, el `update` no tocaba
   * una sola columna... y el registro de auditoría se escribía igual. La tabla
   * `auditoria` no tiene policy de update ni de delete y un trigger las
   * rechaza: cada fila que entra ahí es para siempre, así que una por no-op es
   * ruido permanente en la única tabla que no se puede limpiar.
   *
   * La punta de Mantenimiento ya se defendía así (su `hayCambios`); esta no, y
   * la necesita más: allá la pantalla apaga el botón cuando no hay cambios y
   * acá no hay freno del lado del navegador.
   */
  if (!Object.keys(data).length) {
    return NextResponse.json(
      {
        error:
          "No hay nada para cambiar: mandá al menos uno de empleado, fechaDesde, fechaHasta, " +
          "tipo, justificada u observaciones",
      },
      { status: 400 }
    );
  }

  // Lo que decía antes, que es lo que el registro guarda y lo que después no se
  // puede reconstruir. De paso, una ausencia que no existe ahora contesta 404 en
  // vez del error interno que devolvía el `.single()` sobre cero filas.
  const previa = await laAusencia(supabase, id);
  if (previa.error) return previa.error;

  // El registro va antes del cambio: si no entra, la fila no se toca.
  const sinRegistro = await problemaDeAuditoria(
    supabase,
    "corregir",
    previa.ausencia,
    comoSeLee({ ...previa.ausencia, ...data })
  );
  if (sinRegistro) return sinRegistro;

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

  // Igual que el PUT: se lee lo que había, se registra, y recién ahí se borra.
  // Un borrado no deja rastro —`calculos_diarios` se recalcula y el día vuelve a
  // verse como si nunca hubiera habido una ausencia—, así que el registro es lo
  // único que después puede decir qué había.
  const previa = await laAusencia(supabase, id);
  if (previa.error) return previa.error;

  const sinRegistro = await problemaDeAuditoria(supabase, "borrar", previa.ausencia, null);
  if (sinRegistro) return sinRegistro;

  const { data: ausencia, error } = await supabase.from("ausencias").delete().eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recalcularEmpleadoPeriodo(supabase, ausencia.empleado_id, new Date(ausencia.fecha_desde), new Date(ausencia.fecha_hasta));
  return new NextResponse(null, { status: 204 });
}
