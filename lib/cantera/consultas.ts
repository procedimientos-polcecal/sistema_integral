import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import type { Bochon, Consumo, Insumo, Voladura, Yacimiento } from "./types";

/**
 * Las lecturas del módulo Cantera.
 *
 * Reglas del repo que acá pesan: `traerTodo()` y no `.limit()` en todo lo que
 * pueda crecer —`cantera_consumos` suma ~40 filas por voladura y ya arranca
 * arriba de las 1.000 con la importación—; y el `select()` **va literal en cada
 * llamada**, porque armado en una constante Supabase pierde la inferencia de
 * tipos y todo lo de abajo queda en `any`. Sí, se repite; es lo que hace
 * Despacho por lo mismo.
 *
 * Los embeds nombran la FK a mano (`cantera_yacimientos!yacimiento_id`) porque
 * `cantera_bochones` tiene dos caminos a `cantera_yacimientos` — trampa de
 * PostgREST que ya rompió el listado de Compras.
 */

export async function traerYacimientos(
  supabase: SupabaseClient,
  soloActivos = false
): Promise<Yacimiento[]> {
  let consulta = supabase
    .from("cantera_yacimientos")
    .select("id, codigo, nombre, material, densidad_t_m3, burden_m, espaciamiento_m, activo, orden")
    .order("orden")
    .order("nombre");
  if (soloActivos) consulta = consulta.eq("activo", true);
  const { data, error } = await consulta;
  if (error) throw new Error(error.message);
  return (data ?? []) as Yacimiento[];
}

export async function traerInsumos(
  supabase: SupabaseClient,
  soloActivos = false
): Promise<Insumo[]> {
  let consulta = supabase
    .from("cantera_insumos")
    .select("id, nombre, tipo, precio_usd, activo, orden")
    .order("tipo")
    .order("orden")
    .order("nombre");
  if (soloActivos) consulta = consulta.eq("activo", true);
  const { data, error } = await consulta;
  if (error) throw new Error(error.message);
  return (data ?? []) as Insumo[];
}

/** Las voladuras de un yacimiento, de la más reciente a la más vieja. */
export async function traerVoladurasDeYacimiento(
  supabase: SupabaseClient,
  yacimientoId: string
): Promise<Voladura[]> {
  return traerTodo<Voladura>((desde, hasta) =>
    supabase
      .from("cantera_voladuras")
      .select(
        "id, codigo, yacimiento_id, anio, correlativo, perf_inicio, perf_fin, pozos, metros_por_pozo, burden_m, espaciamiento_m, perf_precio_usd_m, perf_tc_usd, perf_odoo_move_id, perf_odoo_move_name, perf_odoo_empresa, perf_odoo_ref, perf_odoo_importe, perf_odoo_leido_en, perf_conforme, perf_conforme_obs, perf_conforme_por, perf_conforme_en, vol_fecha_carga, vol_fecha, vol_pozos, vol_metros_por_pozo, vol_burden_m, vol_espaciamiento_m, vol_tc_usd, explosivos_raw, toneladas_planilla, vol_odoo_move_id, vol_odoo_move_name, vol_odoo_empresa, vol_odoo_ref, vol_odoo_importe, vol_odoo_leido_en, vol_conforme, vol_conforme_obs, vol_conforme_por, vol_conforme_en, observaciones, origen, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en"
      )
      .eq("yacimiento_id", yacimientoId)
      .order("anio", { ascending: false })
      .order("correlativo", { ascending: false })
      .range(desde, hasta)
  );
}

export async function traerBochonesDeYacimiento(
  supabase: SupabaseClient,
  yacimientoId: string
): Promise<Bochon[]> {
  return traerTodo<Bochon>((desde, hasta) =>
    supabase
      .from("cantera_bochones")
      .select(
        "id, codigo, yacimiento_id, anio, correlativo, voladura_codigo, inicio, fin, pozos, metros_perforados, precio_usd_m, tc_usd, odoo_move_id, odoo_move_name, odoo_empresa, odoo_ref, odoo_importe, odoo_leido_en, conforme, conforme_obs, conforme_por, conforme_en, observaciones, origen, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en"
      )
      .eq("yacimiento_id", yacimientoId)
      .order("anio", { ascending: false })
      .order("correlativo", { ascending: false })
      .range(desde, hasta)
  );
}

export async function traerVoladura(
  supabase: SupabaseClient,
  codigo: string
): Promise<Voladura | null> {
  const { data, error } = await supabase
    .from("cantera_voladuras")
    .select(
      "id, codigo, yacimiento_id, anio, correlativo, perf_inicio, perf_fin, pozos, metros_por_pozo, burden_m, espaciamiento_m, perf_precio_usd_m, perf_tc_usd, perf_odoo_move_id, perf_odoo_move_name, perf_odoo_empresa, perf_odoo_ref, perf_odoo_importe, perf_odoo_leido_en, perf_conforme, perf_conforme_obs, perf_conforme_por, perf_conforme_en, vol_fecha_carga, vol_fecha, vol_pozos, vol_metros_por_pozo, vol_burden_m, vol_espaciamiento_m, vol_tc_usd, explosivos_raw, toneladas_planilla, vol_odoo_move_id, vol_odoo_move_name, vol_odoo_empresa, vol_odoo_ref, vol_odoo_importe, vol_odoo_leido_en, vol_conforme, vol_conforme_obs, vol_conforme_por, vol_conforme_en, observaciones, origen, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en"
    )
    .eq("codigo", codigo)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Voladura | null) ?? null;
}

export async function traerConsumos(
  supabase: SupabaseClient,
  voladuraCodigo: string
): Promise<Consumo[]> {
  const { data, error } = await supabase
    .from("cantera_consumos")
    .select("id, voladura_codigo, insumo_id, insumo_raw, tipo, cantidad, precio_usd, orden")
    .eq("voladura_codigo", voladuraCodigo)
    .order("orden");
  if (error) throw new Error(error.message);
  return (data ?? []) as Consumo[];
}

/**
 * Los correlativos ya usados para un `(yacimiento, año)`. De acá sale el
 * próximo número del código.
 */
export async function correlativosUsados(
  supabase: SupabaseClient,
  tabla: "cantera_voladuras" | "cantera_bochones",
  yacimientoId: string,
  anio: number
): Promise<number[]> {
  const { data, error } = await supabase
    .from(tabla)
    .select("correlativo")
    .eq("yacimiento_id", yacimientoId)
    .eq("anio", anio);
  if (error) throw new Error(error.message);
  return (data ?? []).map((f) => (f as { correlativo: number }).correlativo);
}
