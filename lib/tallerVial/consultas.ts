import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { compararCodigosEM } from "./equipos";
import type { CargaDB, EstadoDiarioDB, ReparacionDB, RepuestoAsignadoConArticulo, ServiceDB } from "./types";

/** Los equipos móviles: la tabla `equipos` de Mantenimiento, filtrada a los códigos EM* — Taller Vial no tiene catálogo propio. */
export interface EquipoTallerVial {
  id: string;
  code: string;
  name: string;
  status: string;
}

export async function traerEquiposTallerVial(supabase: SupabaseClient): Promise<EquipoTallerVial[]> {
  const { data, error } = await supabase
    .from("equipos")
    .select("id, code, name, status")
    .ilike("code", "EM%")
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return ((data ?? []) as EquipoTallerVial[]).sort((a, b) => compararCodigosEM(a.code, b.code));
}

export interface FiltrosDeCargas {
  equipoId?: string;
  /** "YYYY-MM": ese mes completo. */
  mes?: string;
}

export async function traerCargas(supabase: SupabaseClient, filtros: FiltrosDeCargas = {}): Promise<CargaDB[]> {
  return traerTodo<CargaDB>((desde, hasta) => {
    let q = supabase
      .from("taller_vial_cargas")
      .select("id, equipo_id, equipo_raw, fecha, litros, lectura, observaciones, cargado_por, cargado_en, actualizado_por, actualizado_en");
    if (filtros.equipoId) q = q.eq("equipo_id", filtros.equipoId);
    if (filtros.mes) {
      const [anio, mesNum] = filtros.mes.split("-").map(Number);
      const primerDia = `${filtros.mes}-01`;
      const ultimoDia = new Date(Date.UTC(anio, mesNum, 0)).toISOString().slice(0, 10);
      q = q.gte("fecha", primerDia).lte("fecha", ultimoDia);
    }
    return q.order("fecha", { ascending: false }).range(desde, hasta);
  });
}

export interface FiltrosDeEstados {
  equipoId?: string;
  /** "YYYY-MM": ese mes completo. */
  mes?: string;
}

export async function traerEstadosDiarios(supabase: SupabaseClient, filtros: FiltrosDeEstados = {}): Promise<EstadoDiarioDB[]> {
  return traerTodo<EstadoDiarioDB>((desde, hasta) => {
    let q = supabase.from("taller_vial_estados_diarios").select("id, equipo_id, fecha, estado");
    if (filtros.equipoId) q = q.eq("equipo_id", filtros.equipoId);
    if (filtros.mes) {
      const [anio, mesNum] = filtros.mes.split("-").map(Number);
      const primerDia = `${filtros.mes}-01`;
      const ultimoDia = new Date(Date.UTC(anio, mesNum, 0)).toISOString().slice(0, 10);
      q = q.gte("fecha", primerDia).lte("fecha", ultimoDia);
    }
    return q.order("fecha", { ascending: false }).range(desde, hasta);
  });
}

/** Todos los services cargados de un equipo (o de todos) — la cascada necesita el historial completo, no sólo un mes. */
export async function traerServices(supabase: SupabaseClient, equipoId?: string): Promise<ServiceDB[]> {
  return traerTodo<ServiceDB>((desde, hasta) => {
    let q = supabase.from("taller_vial_services").select("id, equipo_id, tier, fecha, horometro, observaciones, cargado_por, cargado_en");
    if (equipoId) q = q.eq("equipo_id", equipoId);
    return q.order("fecha", { ascending: false }).range(desde, hasta);
  });
}

export async function traerReparaciones(supabase: SupabaseClient, equipoId?: string): Promise<ReparacionDB[]> {
  return traerTodo<ReparacionDB>((desde, hasta) => {
    let q = supabase
      .from("taller_vial_reparaciones")
      .select("id, equipo_id, tipo, fecha, descripcion, horas, horometro, observaciones, cargado_por, cargado_en");
    if (equipoId) q = q.eq("equipo_id", equipoId);
    return q.order("fecha", { ascending: false }).range(desde, hasta);
  });
}

export interface FiltrosDeRepuestos {
  serviceId?: string;
  reparacionId?: string;
}

/** Los repuestos reservados/confirmados de un service o una reparación, con el código y la descripción del artículo ya resueltos. */
export async function traerRepuestosAsignados(
  supabase: SupabaseClient,
  filtros: FiltrosDeRepuestos = {}
): Promise<RepuestoAsignadoConArticulo[]> {
  let q = supabase
    .from("taller_vial_repuestos_asignados")
    .select(
      "id, service_id, reparacion_id, articulo_id, cantidad, estado, movimiento_id, cargado_por, cargado_en, confirmado_por, confirmado_en, inventario_articulos!articulo_id(codigo, descripcion)"
    )
    .order("cargado_en", { ascending: false });
  if (filtros.serviceId) q = q.eq("service_id", filtros.serviceId);
  if (filtros.reparacionId) q = q.eq("reparacion_id", filtros.reparacionId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  type Fila = Omit<RepuestoAsignadoConArticulo, "articulo_codigo" | "articulo_descripcion"> & {
    inventario_articulos: { codigo: string; descripcion: string } | null;
  };
  return ((data ?? []) as unknown as Fila[]).map(({ inventario_articulos, ...f }) => ({
    ...f,
    articulo_codigo: inventario_articulos?.codigo ?? "",
    articulo_descripcion: inventario_articulos?.descripcion ?? "",
  }));
}
