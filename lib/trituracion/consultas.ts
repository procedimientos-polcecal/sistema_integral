import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";

export interface PlantaDB {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
  orden: number;
}

export async function traerPlantas(supabase: SupabaseClient, soloActivas = true): Promise<PlantaDB[]> {
  let q = supabase.from("trituracion_plantas").select("id, codigo, nombre, activa, orden");
  if (soloActivas) q = q.eq("activa", true);
  const { data, error } = await q.order("orden", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PlantaDB[];
}

export interface ParteDB {
  id: string;
  planta_id: string;
  fecha: string;
  estado: string;
  motivo_no_operativo: string | null;
  material: string | null;
  origen: string | null;
  hora_inicio: string | null;
  hora_fin: string | null;
  operario_id: string | null;
  operario_raw: string | null;
  horas_mantenimiento: number;
  horas_falta_piedra: number;
  horas_produccion: number;
  horas_otro: number;
  motivo_otro: string | null;
  camiones_llegados: number | null;
  toneladas_procesadas: number | null;
  observaciones: string | null;
  sheets_pendiente: string | null;
  sheets_pendiente_en: string | null;
  cargado_por: string | null;
  cargado_en: string;
  actualizado_por: string | null;
  actualizado_en: string | null;
}

export interface FiltrosDePartes {
  plantaId?: string;
  /** "YYYY-MM-DD" */
  desde?: string;
  /** "YYYY-MM-DD" */
  hasta?: string;
}

export async function traerPartes(supabase: SupabaseClient, filtros: FiltrosDePartes = {}): Promise<ParteDB[]> {
  return traerTodo<ParteDB>((desde, hasta) => {
    let q = supabase
      .from("trituracion_partes")
      .select("id, planta_id, fecha, estado, motivo_no_operativo, material, origen, hora_inicio, hora_fin, operario_id, operario_raw, horas_mantenimiento, horas_falta_piedra, horas_produccion, horas_otro, motivo_otro, camiones_llegados, toneladas_procesadas, observaciones, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en");
    if (filtros.plantaId) q = q.eq("planta_id", filtros.plantaId);
    if (filtros.desde) q = q.gte("fecha", filtros.desde);
    if (filtros.hasta) q = q.lte("fecha", filtros.hasta);
    return q.order("fecha", { ascending: false }).range(desde, hasta);
  });
}

export async function traerParte(
  supabase: SupabaseClient,
  plantaId: string,
  fecha: string
): Promise<ParteDB | null> {
  const { data, error } = await supabase
    .from("trituracion_partes")
    .select("id, planta_id, fecha, estado, motivo_no_operativo, material, origen, hora_inicio, hora_fin, operario_id, operario_raw, horas_mantenimiento, horas_falta_piedra, horas_produccion, horas_otro, motivo_otro, camiones_llegados, toneladas_procesadas, observaciones, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en")
    .eq("planta_id", plantaId)
    .eq("fecha", fecha)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export interface EmpleadoLiviano {
  id: string;
  nombre: string;
  apellido: string;
}

/**
 * Los operarios para el selector del parte: sólo los de los sectores de
 * Cantera/Trituración (`Cantera y Planta de Trituración`, `Trituración 1/2/3`
 * al 18/09/2026 — puede haber otros nombrados igual mañana), no el listado
 * completo de `empleados` del núcleo. Se resuelve por nombre de sector en vez
 * de un id fijo: `sectores` no tiene una columna que distinga "es de
 * trituración", así que el texto es lo único con qué filtrar, y conviene que
 * alcance un sector nuevo con "Trituración" en el nombre sin migrar nada.
 */
export async function traerOperariosDeTrituracion(supabase: SupabaseClient): Promise<EmpleadoLiviano[]> {
  const { data: sectores, error: errSectores } = await supabase
    .from("sectores")
    .select("id, nombre")
    .or("nombre.ilike.%cantera%,nombre.ilike.%tritura%");
  if (errSectores) throw new Error(errSectores.message);

  const sectorIds = (sectores ?? []).map((s) => s.id as string);
  if (sectorIds.length === 0) return [];

  const { data, error } = await supabase
    .from("empleados")
    .select("id, nombre, apellido")
    .eq("activo", true)
    .in("sector_id", sectorIds)
    .order("apellido", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as EmpleadoLiviano[];
}
