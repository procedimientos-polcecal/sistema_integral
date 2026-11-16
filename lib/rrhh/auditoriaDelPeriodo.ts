import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditar, nombreParaAuditoria } from "@/lib/core/auditoria";

/**
 * El registro de auditoría de un período de vacaciones, para
 * `app/api/rrhh/vacaciones/[id]/route.ts`.
 *
 * POR QUÉ NO SE REUSA EL DE `rrhh/ausencias/[id]`
 *
 * `comoSeLee` y `problemaDeAuditoria` ya están duplicados entre la punta de
 * RRHH y la del taller, **a propósito**, con el porqué escrito en el docstring
 * de la de RRHH. Ésta es una tercera punta y tampoco se comparte, por dos
 * razones: mover el de RRHH obligaría a editar una ruta que este cambio no
 * necesita tocar —en un árbol donde suele haber otra sesión trabajando—, y
 * sobre todo **lo que hay que registrar acá no es lo mismo**.
 *
 * La diferencia que importa es `anio_correspondiente`. Vive en `vacaciones` y
 * no en `ausencias`, no se puede reconstruir de las fechas, y es el campo que
 * decide **de qué año se descuentan los días**: corregirlo mueve el balance de
 * un año a otro y no deja rastro en ninguna otra parte. Un registro que
 * describiera sólo la ausencia diría que alguien corrigió algo y no qué.
 *
 * POR QUÉ LA ENTIDAD ES `vacaciones` Y NO `ausencias`
 *
 * Porque es el período lo que se está corrigiendo o borrando. El `DELETE`
 * borra la ausencia —y la cascada se lleva el período—, pero lo que la persona
 * pidió borrar, y lo que después alguien va a buscar, es el período.
 * `contexto.ausencia_id` deja el puente para encontrar la otra fila.
 *
 * El contrato es el mismo que el de la otra punta y no se negocia: **el
 * registro va antes del cambio, y si no entra, no se escribe nada.**
 */

export interface PeriodoParaAuditoria {
  id: string;
  empleado_id: string;
  ausencia_id: string | null;
  anio_correspondiente: unknown;
  fecha_desde: unknown;
  fecha_hasta: unknown;
  dias_tomados: unknown;
  observaciones: unknown;
}

/** Una fecha de la base como "YYYY-MM-DD" pelado: a veces llega con timestamp. */
function dia(v: unknown): string {
  return String(v ?? "").slice(0, 10);
}

/**
 * El período en una línea, para el registro: lo que decía, no sólo que pasó
 * algo.
 *
 * Lleva el año adelante porque es lo que no se puede reconstruir mirando la
 * fila de después, y los días entre paréntesis porque es el número que se
 * descuenta del balance.
 */
export function comoSeLeeElPeriodo(
  p: Omit<PeriodoParaAuditoria, "id" | "empleado_id" | "ausencia_id">,
): string {
  const obs =
    typeof p.observaciones === "string" && p.observaciones.trim()
      ? ` — ${p.observaciones.trim()}`
      : "";
  return `Vacaciones ${String(p.anio_correspondiente)} del ${dia(p.fecha_desde)} al ${dia(p.fecha_hasta)} (${String(p.dias_tomados)} días)${obs}`;
}

/**
 * El registro, que va **antes** del cambio: si no entra, el cambio no se hace.
 *
 * Corregir o borrar un período **pierde lo que había**: no hay historial de
 * `vacaciones`, el `on delete cascade` se lo lleva sin dejar nada, y
 * `recalcularEmpleadoPeriodo` rehace `calculos_diarios` sobre las fechas
 * nuevas. Es el mismo orden que fijó `borradoDeEspejo` para los borrados, y por
 * la misma razón.
 *
 * Devuelve la respuesta de error, o null si quedó registrado.
 */
export async function problemaDeAuditoriaDelPeriodo(
  supabase: SupabaseClient,
  accion: "corregir" | "borrar",
  anterior: PeriodoParaAuditoria,
  valorNuevo: string | null,
): Promise<NextResponse | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: quien } = user
    ? await supabase.from("usuarios").select("nombre, apellido, email").eq("id", user.id).maybeSingle()
    : { data: null };

  const registro = await auditar(supabase, {
    modulo: "rrhh",
    entidad: "vacaciones",
    entidadId: anterior.id,
    accion,
    usuario: user ? { id: user.id, nombre: nombreParaAuditoria(quien) } : null,
    valorAnterior: comoSeLeeElPeriodo(anterior),
    valorNuevo,
    contexto: {
      ruta: "rrhh/vacaciones",
      empleado_id: anterior.empleado_id,
      ausencia_id: anterior.ausencia_id,
      anterior: {
        anio_correspondiente: anterior.anio_correspondiente,
        fecha_desde: dia(anterior.fecha_desde),
        fecha_hasta: dia(anterior.fecha_hasta),
        dias_tomados: anterior.dias_tomados,
        observaciones: typeof anterior.observaciones === "string" ? anterior.observaciones : null,
      },
    },
  });

  if (!registro.ok) {
    const que = accion === "borrar" ? "el borrado" : "la corrección";
    const y = accion === "borrar" ? "no se borró" : "no se cambió nada";
    return NextResponse.json(
      { error: `No se pudo registrar ${que} en la auditoría, así que ${y}: ${registro.error}` },
      { status: 500 },
    );
  }
  return null;
}
