import type { SupabaseClient } from "@supabase/supabase-js";
import type { Punto } from "./engine/geo";
import { distanciaRuta } from "./engine/geo";
import { getGeometriaRuta } from "./engine/osrm";

/**
 * Recalcula km/minutos/geometría de una hoja de ruta a partir del orden
 * actual de sus asientos (después de una edición manual: reordenar, agregar
 * o quitar un empleado). Se llama tras cada mutación en vez de disparar una
 * regeneración completa, igual que el original.
 */
export async function refrescarGeometriaHoja(supabase: SupabaseClient, hojaRutaId: string): Promise<void> {
  const { data: hoja } = await supabase.from("hojas_ruta").select("tipo").eq("id", hojaRutaId).single();
  if (!hoja) return;

  const { data: config } = await supabase.from("remises_config").select("fabrica_lat, fabrica_lng, velocidad_kmh").eq("id", 1).single();
  if (!config?.fabrica_lat || !config?.fabrica_lng) return;
  const fabrica: Punto = { lat: Number(config.fabrica_lat), lng: Number(config.fabrica_lng) };

  const { data: asientos } = await supabase
    .from("asientos")
    .select("empleado_id, orden, empleados(remises_empleados_datos(lat, lng))")
    .eq("hoja_ruta_id", hojaRutaId)
    .order("orden");

  const puntos: Punto[] = (asientos ?? [])
    .map((a) => {
      const emp = a.empleados as unknown as { remises_empleados_datos: { lat: number | null; lng: number | null } | null } | null;
      const d = emp?.remises_empleados_datos;
      return d?.lat != null && d?.lng != null ? { lat: Number(d.lat), lng: Number(d.lng) } : null;
    })
    .filter((p): p is Punto => p !== null);

  if (!puntos.length) {
    await supabase.from("hojas_ruta").update({ km: 0, minutos: 0, geometria: null }).eq("id", hojaRutaId);
    return;
  }

  const waypoints = hoja.tipo === "ida" ? [...puntos, fabrica] : [fabrica, ...puntos];
  const res = await getGeometriaRuta(waypoints);

  const km = res ? Math.round(res.distanciaKm * 10) / 10 : Math.round(distanciaRuta(waypoints) * 10) / 10;
  const minutos = res ? Math.round(res.duracionMin) : Math.round((km / (Number(config.velocidad_kmh) || 40)) * 60);
  const geometria = res ? res.geometria : null;

  await supabase.from("hojas_ruta").update({ km, minutos, geometria }).eq("id", hojaRutaId);
}
