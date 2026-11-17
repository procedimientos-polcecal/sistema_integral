import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/rrhh/route-utils";
import { recalcularEmpleadoPeriodo } from "@/lib/rrhh/engine/recalcular";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { z } from "zod";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { sincronizarPeriodoVacaciones, diasEntre } from "@/lib/rrhh/vacacionesDeAusencia";
import {
  cambiosParaLaAusencia,
  hayAlgoQueCambiar,
  nadaCambioDeVerdad,
  rangoAlReves,
} from "@/lib/rrhh/periodoDeVacaciones";
import {
  comoSeLeeElPeriodo,
  problemaDeAuditoriaDelPeriodo,
  type PeriodoParaAuditoria,
} from "@/lib/rrhh/auditoriaDelPeriodo";

/*
 * Corregir o borrar un período de vacaciones toca **la ausencia**, no el
 * período.
 *
 * Desde el 16/11/2026 todo período nace de una ausencia (ver el `POST` de
 * `../route.ts`), así que la ausencia es el original y el período es el espejo
 * que escribe `sincronizarPeriodoVacaciones()`. Editar el espejo sin tocar el
 * original dejaba a `/disponibilidad`, al taller y a los reportes mostrando las
 * fechas viejas; borrarlo dejaba la ausencia viva para siempre.
 *
 * Las dos operaciones **se auditan**, con el mismo contrato que
 * `app/api/rrhh/ausencias/[id]/route.ts`: el registro va antes del cambio y si
 * no entra, no se escribe nada. Ver `lib/rrhh/auditoriaDelPeriodo.ts` para por
 * qué la entidad es `vacaciones` y no `ausencias`.
 *
 * Un período **sin** `ausencia_id` se sigue tratando como antes y sin registro:
 * no es una ausencia y nunca lo fue. Después del relleno de los 20 huérfanos no
 * debería quedar ninguno, pero una fila escrita a mano en la base no tiene por
 * qué romper la edición.
 *
 * Todo opcional porque es un PUT parcial. `diasTomados` **ya no se acepta**: ese
 * número sale del calendario y lo escribe la sincronización, así que un campo
 * que lo recibiera y después lo descartara sería peor que no tenerlo. Una
 * pestaña vieja todavía lo manda; zod lo ignora por no estar en el esquema.
 */
const Cuerpo = z.object({
  employeeId: z.uuid().optional(),
  anioCorrespondiente: z.number().int().optional(),
  fechaDesde: z.iso.date().optional(),
  fechaHasta: z.iso.date().optional(),
  observaciones: z.string().nullable().optional(),
});

/** Las columnas del período que hacen falta para auditarlo y para decidir el camino. */
const COLUMNAS_DEL_PERIODO =
  "id, empleado_id, ausencia_id, anio_correspondiente, fecha_desde, fecha_hasta, dias_tomados, observaciones";

/** Una fecha de la base como "YYYY-MM-DD" pelado. */
function dia(v: unknown): string {
  return String(v ?? "").slice(0, 10);
}

async function elPeriodo(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data, error } = await supabase
    .from("vacaciones")
    .select(COLUMNAS_DEL_PERIODO)
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!data) return { error: NextResponse.json({ error: "No encontrado" }, { status: 404 }) };
  return { periodo: data as unknown as PeriodoParaAuditoria };
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const validado = validar(Cuerpo, await cuerpoJson(request));
  if (!validado.ok) return errorDeValidacion(validado.problemas);
  const body = validado.datos;

  const traido = await elPeriodo(supabase, id);
  if (traido.error) return traido.error;
  const periodo = traido.periodo;

  /*
   * Un PUT que no cambia nada no se escribe.
   *
   * Todos los campos son opcionales, así que un `{}` llegaba hasta acá y, ahora
   * que esta ruta audita, escribiría una fila de `auditoria` por un cambio que
   * no ocurrió. Esa tabla no tiene policy de update ni de delete y un trigger
   * las rechaza: cada fila que entra ahí es para siempre.
   *
   * `hayAlgoQueCambiar` cuenta el año aunque no sea una columna de la ausencia
   * —vive en el período—, que es justo el caso que un freno ingenuo rechazaría.
   */
  if (!hayAlgoQueCambiar(body)) {
    return NextResponse.json(
      {
        error:
          "No hay nada para cambiar: mandá al menos uno de empleado, fechaDesde, " +
          "fechaHasta, anioCorrespondiente u observaciones",
      },
      { status: 400 }
    );
  }

  const desdeFinal = body.fechaDesde ?? dia(periodo.fecha_desde);
  const hastaFinal = body.fechaHasta ?? dia(periodo.fecha_hasta);
  if (rangoAlReves(desdeFinal, hastaFinal)) {
    return NextResponse.json(
      { error: "La fecha hasta no puede ser anterior a la fecha desde" },
      { status: 400 }
    );
  }

  const empleadoAnterior = periodo.empleado_id;
  const desdeAnterior = dia(periodo.fecha_desde);
  const hastaAnterior = dia(periodo.fecha_hasta);

  // ── El camino viejo: un período que no nació de una ausencia ──────────
  if (!periodo.ausencia_id) {
    const data: Record<string, unknown> = cambiosParaLaAusencia(body);
    if (body.anioCorrespondiente !== undefined) data.anio_correspondiente = body.anioCorrespondiente;
    if (body.fechaDesde !== undefined || body.fechaHasta !== undefined) {
      data.dias_tomados = diasEntre(desdeFinal, hastaFinal);
    }

    const { data: actualizado, error } = await supabase
      .from("vacaciones")
      .update(data)
      .eq("id", id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    await recalcularEmpleadoPeriodo(
      supabase,
      empleadoAnterior,
      new Date(desdeAnterior),
      new Date(hastaAnterior)
    );
    if (
      actualizado.empleado_id !== empleadoAnterior ||
      dia(actualizado.fecha_desde) !== desdeAnterior ||
      dia(actualizado.fecha_hasta) !== hastaAnterior
    ) {
      await recalcularEmpleadoPeriodo(
        supabase,
        actualizado.empleado_id,
        new Date(dia(actualizado.fecha_desde)),
        new Date(dia(actualizado.fecha_hasta))
      );
    }
    return NextResponse.json(actualizado);
  }

  // ── El camino normal: se corrige la ausencia y el período la sigue ────

  // Cómo va a quedar el período, que es lo que la sincronización va a escribir.
  const comoVaAQuedar = comoSeLeeElPeriodo({
    anio_correspondiente: body.anioCorrespondiente ?? periodo.anio_correspondiente,
    fecha_desde: desdeFinal,
    fecha_hasta: hastaFinal,
    dias_tomados: diasEntre(desdeFinal, hastaFinal),
    observaciones:
      body.observaciones !== undefined ? body.observaciones || null : periodo.observaciones,
  });

  /*
   * Un «Guardar cambios» que no cambió nada no se escribe ni se audita.
   *
   * `hayAlgoQueCambiar` mira si **vinieron** campos; esto mira si traen otra
   * cosa. La ficha del empleado manda los cuatro siempre, así que abrir
   * «Editar», arrepentirse y guardar pasaba aquel freno y dejaba una fila de
   * `auditoria` con `valor_anterior` idéntico a `valor_nuevo` — y esa tabla no
   * se puede limpiar.
   *
   * Contesta 200 con el período tal cual está, no un 400: desde el lado de
   * quien apretó el botón no pasó nada malo.
   */
  if (nadaCambioDeVerdad(comoSeLeeElPeriodo(periodo), comoVaAQuedar, empleadoAnterior, body.employeeId)) {
    const { data: sinTocar } = await supabase.from("vacaciones").select("*").eq("id", id).maybeSingle();
    return NextResponse.json(sinTocar);
  }

  // El registro va antes del cambio: si no entra, no se toca nada.
  const sinRegistro = await problemaDeAuditoriaDelPeriodo(
    supabase,
    "corregir",
    periodo,
    comoVaAQuedar
  );
  if (sinRegistro) return sinRegistro;

  const cambios = cambiosParaLaAusencia(body);
  let ausencia;
  if (Object.keys(cambios).length > 0) {
    const { data, error } = await supabase
      .from("ausencias")
      .update(cambios)
      .eq("id", periodo.ausencia_id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    ausencia = data;
  } else {
    // Cambió sólo el año, que no es una columna de la ausencia. La ausencia se
    // trae tal cual está porque la sincronización la necesita entera.
    const { data, error } = await supabase
      .from("ausencias")
      .select("*")
      .eq("id", periodo.ausencia_id)
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    ausencia = data;
  }

  // El único paso que guarda el año, y por eso corre también cuando no hubo
  // ningún cambio de columna en la ausencia.
  await sincronizarPeriodoVacaciones(supabase, ausencia, body.anioCorrespondiente);

  await recalcularEmpleadoPeriodo(
    supabase,
    empleadoAnterior,
    new Date(desdeAnterior),
    new Date(hastaAnterior)
  );
  if (
    ausencia.empleado_id !== empleadoAnterior ||
    dia(ausencia.fecha_desde) !== desdeAnterior ||
    dia(ausencia.fecha_hasta) !== hastaAnterior
  ) {
    await recalcularEmpleadoPeriodo(
      supabase,
      ausencia.empleado_id,
      new Date(dia(ausencia.fecha_desde)),
      new Date(dia(ausencia.fecha_hasta))
    );
  }

  const { data: releido } = await supabase
    .from("vacaciones")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return NextResponse.json(releido);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const traido = await elPeriodo(supabase, id);
  if (traido.error) return traido.error;
  const periodo = traido.periodo;

  const desde = new Date(dia(periodo.fecha_desde));
  const hasta = new Date(dia(periodo.fecha_hasta));

  // Un período que no nació de una ausencia se borra solo, como antes.
  if (!periodo.ausencia_id) {
    const { error } = await supabase.from("vacaciones").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await recalcularEmpleadoPeriodo(supabase, periodo.empleado_id, desde, hasta);
    return new NextResponse(null, { status: 204 });
  }

  // Igual que el PUT: se lee lo que había, se registra, y recién ahí se borra.
  // Lo que se borra es la **ausencia**; el `on delete cascade` de
  // `vacaciones.ausencia_id` se lleva el período. Borrar sólo el período
  // dejaría la ausencia viva y la persona seguiría figurando ausente.
  const sinRegistro = await problemaDeAuditoriaDelPeriodo(supabase, "borrar", periodo, null);
  if (sinRegistro) return sinRegistro;

  const { error } = await supabase.from("ausencias").delete().eq("id", periodo.ausencia_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await recalcularEmpleadoPeriodo(supabase, periodo.empleado_id, desde, hasta);
  return new NextResponse(null, { status: 204 });
}
