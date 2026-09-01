import type { SupabaseClient } from "@supabase/supabase-js";
import { empleadosPermitidos, idsOrDummy } from "./dashboardHelpers";
import { utcDateOnlyFrom } from "./dates";

export interface Indicador {
  cantidad: number;
  porcentaje: number;
}

export interface ResumenHoy {
  totalActivos: number;
  presentes: Indicador;
  ausentes: Indicador;
  tardes: Indicador;
  vacaciones: Indicador;
}

/**
 * Las cuatro tarjetas de arriba del dashboard: presentes, ausentes, tardanzas y
 * vacaciones de hoy.
 *
 * Vive acá y no dentro de la ruta de API para que la pueda llamar también el
 * Server Component de la pantalla. Así el HTML del dashboard llega con los
 * cuatro números adentro, en vez de llegar vacío y pedirlos por fetch recién
 * cuando el navegador terminó de hidratar. Es lo primero que se ve, así que es
 * donde más se nota.
 *
 * La ruta de API sigue existiendo porque los filtros de empresa y sector
 * vuelven a pedir estos números sin recargar la página.
 */
export async function calcularResumenHoy(
  supabase: SupabaseClient,
  filtros: { empresaId?: string | null; sectorId?: string | null } = {}
): Promise<ResumenHoy> {
  const hoyStr = utcDateOnlyFrom(new Date()).toISOString().slice(0, 10);

  const empleados = await empleadosPermitidos(supabase, filtros);
  const empleadoIds = idsOrDummy(empleados.map((e) => e.id));

  const [{ data: calculos }, { data: tardanzasManuales }, { count: vacacionesHoy }] = await Promise.all([
    supabase.from("calculos_diarios").select("empleado_id, ausente, tarde").in("empleado_id", empleadoIds).eq("fecha", hoyStr),
    supabase
      .from("ausencias")
      .select("empleado_id")
      .in("empleado_id", empleadoIds)
      .eq("tipo", "TARDANZA")
      .lte("fecha_desde", hoyStr)
      .gte("fecha_hasta", hoyStr),
    supabase
      .from("vacaciones")
      .select("id", { count: "exact", head: true })
      .in("empleado_id", empleadoIds)
      .lte("fecha_desde", hoyStr)
      .gte("fecha_hasta", hoyStr),
  ]);

  const totalActivos = empleados.length;
  const ausentesHoy = (calculos ?? []).filter((c) => c.ausente).length;
  const presentesHoy = totalActivos - ausentesHoy;

  // Un empleado puede figurar tarde por el cálculo del reloj y además tener una
  // tardanza cargada a mano: se cuenta una vez.
  const tardesIds = new Set<string>([
    ...(calculos ?? []).filter((c) => c.tarde).map((c) => c.empleado_id),
    ...(tardanzasManuales ?? []).map((a) => a.empleado_id),
  ]);

  const pct = (n: number) => (totalActivos > 0 ? Math.round((n / totalActivos) * 1000) / 10 : 0);

  return {
    totalActivos,
    presentes: { cantidad: presentesHoy, porcentaje: pct(presentesHoy) },
    ausentes: { cantidad: ausentesHoy, porcentaje: pct(ausentesHoy) },
    tardes: { cantidad: tardesIds.size, porcentaje: pct(tardesIds.size) },
    vacaciones: { cantidad: vacacionesHoy ?? 0, porcentaje: pct(vacacionesHoy ?? 0) },
  };
}
