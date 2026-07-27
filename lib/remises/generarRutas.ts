import type { SupabaseClient } from "@supabase/supabase-js";
import type { Punto } from "./engine/geo";
import { distanciaRuta } from "./engine/geo";
import { clusterConCapacidad } from "./engine/clustering";
import { vecinoMasCercano, vecinoMasCercanoMatriz } from "./engine/tsp";
import { getMatrizDistancias, getGeometriaRuta } from "./engine/osrm";

export interface GenerarRutasParams {
  fecha: string; // YYYY-MM-DD
  turnoId: string;
  tipo: "ida" | "vuelta";
  /** IDs de empleados a incluir; si no se pasa, se toman de remises_asistencia. */
  empleadoIdsOverride?: string[];
}

export interface GenerarRutasResultado {
  hojasCreadas: number;
  empleadosSinCoordenadas: number;
  capacidadInsuficiente: boolean;
}

/**
 * Genera las hojas de ruta (una por vehículo) para una fecha/turno/tipo,
 * portado de `generateRoutes()` del original: clustering geográfico con
 * capacidad + TSP contra la matriz de duraciones de OSRM (con fallback a
 * línea recta). Reemplaza cualquier hoja de ruta previa para esa
 * fecha/turno/tipo (regenerar es destructivo/idempotente, igual que el
 * original).
 */
export async function generarRutasParaTurno(
  supabase: SupabaseClient,
  params: GenerarRutasParams
): Promise<GenerarRutasResultado | { error: string }> {
  const { fecha, turnoId, tipo } = params;

  const { data: config } = await supabase.from("remises_config").select("*").eq("id", 1).single();
  if (!config?.fabrica_lat || !config?.fabrica_lng) {
    return { error: "Configurá la ubicación de la fábrica primero" };
  }
  const fabrica: Punto & { id: null } = { id: null, lat: Number(config.fabrica_lat), lng: Number(config.fabrica_lng) };

  const { data: vehiculosActivos } = await supabase
    .from("vehiculos")
    .select("id, nombre, capacidad, chofer_id")
    .eq("activo", true);
  if (!vehiculosActivos?.length) return { error: "Agregá al menos un vehículo" };

  let presentIds = params.empleadoIdsOverride;
  if (!presentIds) {
    const { data: asistencia } = await supabase
      .from("remises_asistencia")
      .select("empleado_id")
      .eq("fecha", fecha)
      .eq("turno_id", turnoId);
    presentIds = (asistencia ?? []).map((a) => a.empleado_id);
  }
  if (!presentIds.length) return { error: "Marcá qué empleados vienen en Asistencia" };

  const { data: empleadosRaw } = await supabase
    .from("empleados")
    .select("id, legajo, nombre, apellido, remises_empleados_datos(lat, lng)")
    .in("id", presentIds);

  type EmpConDatos = Punto & { id: string };
  const emps: EmpConDatos[] = [];
  let sinCoordenadas = 0;
  for (const e of empleadosRaw ?? []) {
    const d = e.remises_empleados_datos as unknown as { lat: number | null; lng: number | null } | null;
    if (d?.lat != null && d?.lng != null) {
      emps.push({ id: e.id, lat: Number(d.lat), lng: Number(d.lng) });
    } else {
      sinCoordenadas++;
    }
  }
  if (!emps.length) return { error: "Los empleados marcados no tienen coordenadas. Geocodificalos primero." };

  const sortedVehs = vehiculosActivos.slice().sort((a, b) => (b.capacidad || 8) - (a.capacidad || 8));
  let k = 0;
  let capacidadTotal = 0;
  for (const v of sortedVehs) {
    if (capacidadTotal >= emps.length) break;
    k++;
    capacidadTotal += v.capacidad || 8;
  }
  k = Math.min(k, sortedVehs.length);
  const vehsToUse = sortedVehs.slice(0, k);
  const capacidadInsuficiente = capacidadTotal < emps.length;

  const allPoints: Punto[] = [fabrica, ...emps];
  const matriz = await getMatrizDistancias(allPoints);

  const asignacion = clusterConCapacidad(
    emps,
    vehsToUse.map((v) => v.capacidad || 8)
  );

  // Regenerar es destructivo: se borran las hojas de ruta previas de esta
  // fecha/turno/tipo (asientos cascadea solo).
  await supabase.from("hojas_ruta").delete().eq("fecha", fecha).eq("turno_id", turnoId).eq("tipo", tipo);

  let hojasCreadas = 0;
  for (let vi = 0; vi < k; vi++) {
    const grpEmps = emps.filter((_, i) => asignacion[i] === vi);
    if (!grpEmps.length) continue;
    const veh = vehsToUse[vi];

    let orderedEmps: EmpConDatos[];
    if (matriz) {
      const empIdxInAll = grpEmps.map((e) => emps.indexOf(e) + 1);
      const ordenadoIdx = vecinoMasCercanoMatriz(0, empIdxInAll, matriz.duraciones);
      orderedEmps = ordenadoIdx.map((i) => emps[i - 1]);
    } else {
      orderedEmps = vecinoMasCercano(fabrica, grpEmps);
    }

    // Ida (recogida): el chofer arranca lejos y termina en la fábrica →
    // se invierte para que la parada 1 sea el más lejano. Vuelta (dejada):
    // arranca en la fábrica, va de más cerca a más lejos → sin invertir.
    if (tipo === "ida") orderedEmps = orderedEmps.slice().reverse();

    const waypoints: Punto[] = tipo === "ida" ? [...orderedEmps, fabrica] : [fabrica, ...orderedEmps];

    const geometriaRes = await getGeometriaRuta(waypoints);
    let km: number, minutos: number, geometria: unknown = null;
    if (geometriaRes) {
      km = Math.round(geometriaRes.distanciaKm * 10) / 10;
      minutos = Math.round(geometriaRes.duracionMin);
      geometria = geometriaRes.geometria;
    } else {
      km = Math.round(distanciaRuta(waypoints) * 10) / 10;
      minutos = Math.round((km / (Number(config.velocidad_kmh) || 40)) * 60);
    }

    const { data: hoja, error: errorHoja } = await supabase
      .from("hojas_ruta")
      .insert({
        fecha,
        turno_id: turnoId,
        tipo,
        vehiculo_id: veh.id,
        chofer_id: veh.chofer_id,
        km,
        minutos,
        geometria,
      })
      .select("id")
      .single();
    if (errorHoja || !hoja) continue;

    const asientos = orderedEmps.map((e, i) => ({ hoja_ruta_id: hoja.id, empleado_id: e.id, orden: i }));
    if (asientos.length) await supabase.from("asientos").insert(asientos);
    hojasCreadas++;
  }

  return { hojasCreadas, empleadosSinCoordenadas: sinCoordenadas, capacidadInsuficiente };
}

export interface AgregarHojaParams {
  fecha: string;
  turnoId: string;
  tipo: "ida" | "vuelta";
  vehiculoId: string;
  empleadoIds: string[];
}

/** Agrega una hoja de ruta nueva para un vehículo puntual con los empleados elegidos ("+ Agregar remis"). */
export async function agregarHojaRuta(
  supabase: SupabaseClient,
  params: AgregarHojaParams
): Promise<{ hojaId: string } | { error: string }> {
  const { fecha, turnoId, tipo, vehiculoId, empleadoIds } = params;

  const [{ data: config }, { data: veh }, { data: empleadosRaw }] = await Promise.all([
    supabase.from("remises_config").select("fabrica_lat, fabrica_lng, velocidad_kmh").eq("id", 1).single(),
    supabase.from("vehiculos").select("id, chofer_id").eq("id", vehiculoId).single(),
    supabase.from("empleados").select("id, remises_empleados_datos(lat, lng)").in("id", empleadoIds),
  ]);
  if (!config?.fabrica_lat || !config?.fabrica_lng) return { error: "Configurá la ubicación de la fábrica primero" };
  if (!veh) return { error: "Vehículo no encontrado" };

  const fabrica: Punto = { lat: Number(config.fabrica_lat), lng: Number(config.fabrica_lng) };
  const emps: (Punto & { id: string })[] = [];
  for (const e of empleadosRaw ?? []) {
    const d = e.remises_empleados_datos as unknown as { lat: number | null; lng: number | null } | null;
    if (d?.lat != null && d?.lng != null) emps.push({ id: e.id, lat: Number(d.lat), lng: Number(d.lng) });
  }
  if (!emps.length) return { error: "Los empleados seleccionados no tienen coordenadas" };

  const allPoints = [fabrica, ...emps];
  const matriz = await getMatrizDistancias(allPoints);

  let orderedEmps: (Punto & { id: string })[];
  if (matriz) {
    const idx = vecinoMasCercanoMatriz(0, emps.map((_, i) => i + 1), matriz.duraciones);
    orderedEmps = idx.map((i) => emps[i - 1]);
  } else {
    orderedEmps = vecinoMasCercano(fabrica, emps);
  }
  if (tipo === "ida") orderedEmps = orderedEmps.slice().reverse();

  const waypoints: Punto[] = tipo === "ida" ? [...orderedEmps, fabrica] : [fabrica, ...orderedEmps];
  const geometriaRes = await getGeometriaRuta(waypoints);
  const km = geometriaRes ? Math.round(geometriaRes.distanciaKm * 10) / 10 : Math.round(distanciaRuta(waypoints) * 10) / 10;
  const minutos = geometriaRes
    ? Math.round(geometriaRes.duracionMin)
    : Math.round((km / (Number(config.velocidad_kmh) || 40)) * 60);
  const geometria = geometriaRes ? geometriaRes.geometria : null;

  const { data: hoja, error } = await supabase
    .from("hojas_ruta")
    .insert({ fecha, turno_id: turnoId, tipo, vehiculo_id: vehiculoId, chofer_id: veh.chofer_id, km, minutos, geometria })
    .select("id")
    .single();
  if (error || !hoja) return { error: error?.message ?? "No se pudo crear la hoja de ruta" };

  await supabase
    .from("asientos")
    .insert(orderedEmps.map((e, i) => ({ hoja_ruta_id: hoja.id, empleado_id: e.id, orden: i })));

  return { hojaId: hoja.id };
}

export interface GrupoAplicar {
  vehiculoId: string;
  empleadoIds: string[];
}

/**
 * Aplica un conjunto de grupos (vehículo + empleados) a una fecha/turno/tipo
 * destino, recalculando el orden y la geometría contra los datos actuales
 * (empleados/vehículos pueden haber cambiado desde que se guardó el grupo).
 * Usado tanto por "Aplicar plantilla" como por "Reutilizar" desde Historial
 * — ambos son la misma operación con distinto origen de los grupos.
 * Reemplaza cualquier hoja de ruta previa para esa fecha/turno/tipo.
 */
export async function aplicarGrupos(
  supabase: SupabaseClient,
  params: { fecha: string; turnoId: string; tipo: "ida" | "vuelta"; grupos: GrupoAplicar[] }
): Promise<{ hojasCreadas: number; gruposOmitidos: number } | { error: string }> {
  const { fecha, turnoId, tipo, grupos } = params;

  const { data: config } = await supabase.from("remises_config").select("fabrica_lat, fabrica_lng, velocidad_kmh").eq("id", 1).single();
  if (!config?.fabrica_lat || !config?.fabrica_lng) return { error: "Configurá la ubicación de la fábrica primero" };
  const fabrica: Punto = { lat: Number(config.fabrica_lat), lng: Number(config.fabrica_lng) };

  await supabase.from("hojas_ruta").delete().eq("fecha", fecha).eq("turno_id", turnoId).eq("tipo", tipo);

  const todosEmpleadoIds = [...new Set(grupos.flatMap((g) => g.empleadoIds))];
  const [{ data: vehiculos }, { data: empleadosRaw }] = await Promise.all([
    supabase.from("vehiculos").select("id, chofer_id").in("id", grupos.map((g) => g.vehiculoId)),
    supabase.from("empleados").select("id, remises_empleados_datos(lat, lng)").in("id", todosEmpleadoIds),
  ]);
  const vehiculosPorId = new Map((vehiculos ?? []).map((v) => [v.id, v]));
  const empleadosPorId = new Map<string, Punto & { id: string }>();
  for (const e of empleadosRaw ?? []) {
    const d = e.remises_empleados_datos as unknown as { lat: number | null; lng: number | null } | null;
    if (d?.lat != null && d?.lng != null) empleadosPorId.set(e.id, { id: e.id, lat: Number(d.lat), lng: Number(d.lng) });
  }

  // Marcar asistencia real para que esta fecha/turno quede consistente con lo generado.
  const asistenciaFilas = todosEmpleadoIds.map((empleado_id) => ({ empleado_id, fecha, turno_id: turnoId }));
  if (asistenciaFilas.length) {
    await supabase.from("remises_asistencia").upsert(asistenciaFilas, { onConflict: "empleado_id,fecha,turno_id", ignoreDuplicates: true });
  }

  let hojasCreadas = 0;
  let gruposOmitidos = 0;
  for (const g of grupos) {
    const veh = vehiculosPorId.get(g.vehiculoId);
    const emps = g.empleadoIds.map((id) => empleadosPorId.get(id)).filter((e): e is Punto & { id: string } => !!e);
    if (!veh || !emps.length) {
      gruposOmitidos++;
      continue;
    }

    let orderedEmps = emps;
    const allPoints = [fabrica, ...emps];
    const matriz = await getMatrizDistancias(allPoints);
    if (matriz) {
      const idx = vecinoMasCercanoMatriz(0, emps.map((_, i) => i + 1), matriz.duraciones);
      orderedEmps = idx.map((i) => emps[i - 1]);
    } else {
      orderedEmps = vecinoMasCercano(fabrica, emps);
    }
    if (tipo === "ida") orderedEmps = orderedEmps.slice().reverse();

    const waypoints: Punto[] = tipo === "ida" ? [...orderedEmps, fabrica] : [fabrica, ...orderedEmps];
    const geometriaRes = await getGeometriaRuta(waypoints);
    const km = geometriaRes ? Math.round(geometriaRes.distanciaKm * 10) / 10 : Math.round(distanciaRuta(waypoints) * 10) / 10;
    const minutos = geometriaRes
      ? Math.round(geometriaRes.duracionMin)
      : Math.round((km / (Number(config.velocidad_kmh) || 40)) * 60);
    const geometria = geometriaRes ? geometriaRes.geometria : null;

    const { data: hoja, error } = await supabase
      .from("hojas_ruta")
      .insert({ fecha, turno_id: turnoId, tipo, vehiculo_id: g.vehiculoId, chofer_id: veh.chofer_id, km, minutos, geometria })
      .select("id")
      .single();
    if (error || !hoja) {
      gruposOmitidos++;
      continue;
    }
    await supabase.from("asientos").insert(orderedEmps.map((e, i) => ({ hoja_ruta_id: hoja.id, empleado_id: e.id, orden: i })));
    hojasCreadas++;
  }

  return { hojasCreadas, gruposOmitidos };
}
