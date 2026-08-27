import type { SupabaseClient } from "@supabase/supabase-js";

export interface AusenciaSincronizable {
  id: string;
  empleado_id: string;
  tipo: string;
  justificada: boolean;
  fecha_desde: string;
  fecha_hasta: string;
  observaciones: string | null;
}

/** Días calendario que abarca el rango, incluyendo los dos extremos. */
export function diasEntre(desde: string, hasta: string): number {
  const d = new Date(`${desde}T00:00:00Z`).getTime();
  const h = new Date(`${hasta}T00:00:00Z`).getTime();
  return Math.round((h - d) / 86_400_000) + 1;
}

/**
 * Mantiene sincronizado el período de vacaciones vinculado a una ausencia tipo
 * "Vacaciones": lo crea, actualiza o borra según corresponda, para que el
 * historial de vacaciones y el balance por año reflejen lo que se carga desde
 * el formulario de Ausencias sin que RRHH tenga que cargarlo dos veces.
 *
 * `anioCorrespondienteBody` es lo que llegó en el request. Si viene undefined
 * (edición parcial que no toca el año), se conserva el año que ya tenía el
 * período vinculado en vez de asumir que se quiere desvincular.
 */
export async function sincronizarPeriodoVacaciones(
  supabase: SupabaseClient,
  ausencia: AusenciaSincronizable,
  anioCorrespondienteBody: number | undefined
): Promise<void> {
  const { data: existente } = await supabase
    .from("vacaciones")
    .select("id, anio_correspondiente")
    .eq("ausencia_id", ausencia.id)
    .maybeSingle();

  const anioCorrespondiente = anioCorrespondienteBody ?? existente?.anio_correspondiente;
  const corresponde = ausencia.tipo === "VACACIONES" && ausencia.justificada && anioCorrespondiente != null;

  if (!corresponde) {
    if (existente) await supabase.from("vacaciones").delete().eq("id", existente.id);
    return;
  }

  const datos = {
    empleado_id: ausencia.empleado_id,
    anio_correspondiente: anioCorrespondiente,
    fecha_desde: ausencia.fecha_desde,
    fecha_hasta: ausencia.fecha_hasta,
    dias_tomados: diasEntre(ausencia.fecha_desde, ausencia.fecha_hasta),
    observaciones: ausencia.observaciones,
  };
  if (existente) {
    await supabase.from("vacaciones").update(datos).eq("id", existente.id);
  } else {
    await supabase.from("vacaciones").insert({ ...datos, ausencia_id: ausencia.id });
  }
}
