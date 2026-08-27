import type { SupabaseClient } from "@supabase/supabase-js";
import { addUtcDays, utcDateOnlyFrom } from "./dates";

export interface EmpleadoDashboard {
  id: string;
  sector_id: string | null;
  legajo: string;
  nombre: string;
  apellido: string;
  horas_teoricas_diarias: number;
  valor_hora_normal: number;
  sectores: { nombre: string } | null;
}

export async function empleadosPermitidos(
  supabase: SupabaseClient,
  filtros: { empresaId?: string | null; sectorId?: string | null }
): Promise<EmpleadoDashboard[]> {
  let query = supabase
    .from("empleados")
    .select("id, sector_id, legajo, nombre, apellido, horas_teoricas_diarias, valor_hora_normal, sectores(nombre)")
    .eq("activo", true);
  if (filtros.sectorId) query = query.eq("sector_id", filtros.sectorId);
  if (filtros.empresaId) query = query.eq("empresa_id", filtros.empresaId);
  const { data } = await query;
  return (data ?? []) as unknown as EmpleadoDashboard[];
}

export function periodoARango(periodo: string | null): { desde: Date; hasta: Date } {
  const hoy = utcDateOnlyFrom(new Date());
  if (periodo === "7" || periodo === "15" || periodo === "30") {
    return { desde: addUtcDays(hoy, -(Number(periodo) - 1)), hasta: hoy };
  }
  return { desde: utcDateOnlyFrom(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1))), hasta: hoy };
}

/**
 * Rango explícito desde/hasta elegido en la UI (los gráficos del Dashboard),
 * con el mes en curso como default si no llega ninguno.
 */
export function rangoDesdeHasta(params: URLSearchParams): { desde: Date; hasta: Date } {
  const desde = params.get("desde");
  const hasta = params.get("hasta");
  const hoy = utcDateOnlyFrom(new Date());
  return {
    desde: desde ? utcDateOnlyFrom(new Date(`${desde}T00:00:00Z`)) : utcDateOnlyFrom(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1))),
    hasta: hasta ? utcDateOnlyFrom(new Date(`${hasta}T00:00:00Z`)) : hoy,
  };
}

/** `.in()` de supabase-js con lista vacía genera `IN ()`, inválido en Postgres. */
export function idsOrDummy(ids: string[]): string[] {
  return ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"];
}

export function agruparPorSector<T extends { sector_id: string | null }>(empleados: T[]): Map<string, T[]> {
  const porSector = new Map<string, T[]>();
  for (const e of empleados) {
    if (!e.sector_id) continue;
    const arr = porSector.get(e.sector_id) ?? [];
    arr.push(e);
    porSector.set(e.sector_id, arr);
  }
  return porSector;
}
