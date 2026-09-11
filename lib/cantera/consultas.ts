import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { montoBochon, montoPerforacion } from "./costos";
import { toneladasEstimadas } from "./toneladas";
import { metrosYPozos } from "./tramos";
import type { BochonParaInforme, VoladuraParaInforme } from "./informe";
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

export interface FiltrosDeTablero {
  yacimientoId?: string;
  /** Rango sobre la fecha de voladura (ISO). */
  desde?: string;
  hasta?: string;
}

/**
 * Las voladuras del tablero: de todas las canteras o de una, filtradas por
 * fecha de voladura si se pide. Sin yacimiento y sin fechas, trae todo.
 */
export async function traerVoladuras(
  supabase: SupabaseClient,
  filtros: FiltrosDeTablero = {}
): Promise<Voladura[]> {
  return traerTodo<Voladura>((desde, hasta) => {
    let q = supabase
      .from("cantera_voladuras")
      .select(
        "id, codigo, yacimiento_id, anio, correlativo, perf_inicio, perf_fin, pozos, metros_por_pozo, perf_tramos, vol_tramos, material, densidad_t_m3, burden_m, espaciamiento_m, perf_precio_usd_m, perf_tc_usd, perf_noches_sereno, perf_monto_noche, perf_odoo_move_id, perf_odoo_move_name, perf_odoo_empresa, perf_odoo_ref, perf_odoo_importe, perf_odoo_leido_en, perf_conforme, perf_conforme_obs, perf_conforme_por, perf_conforme_en, vol_fecha_carga, vol_fecha, vol_pozos, vol_metros_por_pozo, vol_burden_m, vol_espaciamiento_m, vol_tc_usd, explosivos_raw, toneladas_planilla, vol_odoo_move_id, vol_odoo_move_name, vol_odoo_empresa, vol_odoo_ref, vol_odoo_importe, vol_odoo_leido_en, vol_conforme, vol_conforme_obs, vol_conforme_por, vol_conforme_en, observaciones, origen, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en"
      );
    if (filtros.yacimientoId) q = q.eq("yacimiento_id", filtros.yacimientoId);
    if (filtros.desde) q = q.gte("vol_fecha", filtros.desde);
    if (filtros.hasta) q = q.lte("vol_fecha", filtros.hasta);
    return q.order("vol_fecha", { ascending: false, nullsFirst: false }).order("codigo").range(desde, hasta);
  });
}

export async function traerBochones(
  supabase: SupabaseClient,
  filtros: FiltrosDeTablero = {}
): Promise<Bochon[]> {
  return traerTodo<Bochon>((desde, hasta) => {
    let q = supabase
      .from("cantera_bochones")
      .select(
        "id, codigo, yacimiento_id, anio, correlativo, voladura_codigo, inicio, fin, fecha_voladura, cantidad, metros_perforados, precio_usd_m, tc_usd, odoo_move_id, odoo_move_name, odoo_empresa, odoo_ref, odoo_importe, odoo_leido_en, conforme, conforme_obs, conforme_por, conforme_en, observaciones, origen, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en"
      );
    if (filtros.yacimientoId) q = q.eq("yacimiento_id", filtros.yacimientoId);
    if (filtros.desde) q = q.gte("fecha_voladura", filtros.desde);
    if (filtros.hasta) q = q.lte("fecha_voladura", filtros.hasta);
    return q.order("fecha_voladura", { ascending: false, nullsFirst: false }).order("codigo").range(desde, hasta);
  });
}

/** Los consumos de varias voladuras de una, para el tablero. */
export async function traerConsumosDe(
  supabase: SupabaseClient,
  codigos: string[]
): Promise<Consumo[]> {
  if (codigos.length === 0) return [];
  return traerTodo<Consumo>((desde, hasta) =>
    supabase
      .from("cantera_consumos")
      .select("id, voladura_codigo, insumo_id, insumo_raw, tipo, cantidad, precio_usd, orden")
      .in("voladura_codigo", codigos)
      .order("orden")
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
      "id, codigo, yacimiento_id, anio, correlativo, perf_inicio, perf_fin, pozos, metros_por_pozo, perf_tramos, vol_tramos, material, densidad_t_m3, burden_m, espaciamiento_m, perf_precio_usd_m, perf_tc_usd, perf_noches_sereno, perf_monto_noche, perf_odoo_move_id, perf_odoo_move_name, perf_odoo_empresa, perf_odoo_ref, perf_odoo_importe, perf_odoo_leido_en, perf_conforme, perf_conforme_obs, perf_conforme_por, perf_conforme_en, vol_fecha_carga, vol_fecha, vol_pozos, vol_metros_por_pozo, vol_burden_m, vol_espaciamiento_m, vol_tc_usd, explosivos_raw, toneladas_planilla, vol_odoo_move_id, vol_odoo_move_name, vol_odoo_empresa, vol_odoo_ref, vol_odoo_importe, vol_odoo_leido_en, vol_conforme, vol_conforme_obs, vol_conforme_por, vol_conforme_en, observaciones, origen, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en"
    )
    .eq("codigo", codigo)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Voladura | null) ?? null;
}

export async function traerBochon(
  supabase: SupabaseClient,
  codigo: string
): Promise<Bochon | null> {
  const { data, error } = await supabase
    .from("cantera_bochones")
    .select(
      "id, codigo, yacimiento_id, anio, correlativo, voladura_codigo, inicio, fin, fecha_voladura, cantidad, metros_perforados, precio_usd_m, tc_usd, odoo_move_id, odoo_move_name, odoo_empresa, odoo_ref, odoo_importe, odoo_leido_en, conforme, conforme_obs, conforme_por, conforme_en, observaciones, origen, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en"
    )
    .eq("codigo", codigo)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Bochon | null) ?? null;
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

/**
 * Todo lo que necesita `lib/cantera/informe.ts`, ya armado desde la base: las
 * voladuras (con sus consumos) y los bochones, con los montos y las toneladas
 * despejados. La usan la pantalla del informe y su export a Excel — una sola
 * vez, para que las dos miren exactamente lo mismo.
 */
export async function traerDatosParaInforme(
  supabase: SupabaseClient
): Promise<{ voladuras: VoladuraParaInforme[]; bochones: BochonParaInforme[] }> {
  const [yacimientos, insumos] = await Promise.all([traerYacimientos(supabase), traerInsumos(supabase)]);
  const porId = new Map(yacimientos.map((y) => [y.id, y]));
  const nombreInsumoPorId = new Map(insumos.map((i) => [i.id, i.nombre]));

  const [vs, bs] = await Promise.all([traerVoladuras(supabase, {}), traerBochones(supabase, {})]);
  const consumos = await traerConsumosDe(supabase, vs.map((v) => v.codigo));
  const consumosPorCodigo = new Map<string, Consumo[]>();
  for (const c of consumos) {
    const lista = consumosPorCodigo.get(c.voladura_codigo) ?? [];
    lista.push(c);
    consumosPorCodigo.set(c.voladura_codigo, lista);
  }

  const voladuras: VoladuraParaInforme[] = vs.map((v) => {
    const yac = porId.get(v.yacimiento_id) ?? null;
    const perf = metrosYPozos(v.perf_tramos, v.pozos, v.metros_por_pozo);
    const vol = metrosYPozos(v.vol_tramos, v.vol_pozos, v.vol_metros_por_pozo);
    const toneladasCalculadas = toneladasEstimadas({
      metros: vol.metros ?? perf.metros,
      densidad: v.densidad_t_m3 ?? yac?.densidad_t_m3 ?? null,
      burden: v.vol_burden_m ?? v.burden_m ?? yac?.burden_m ?? null,
      espaciamiento: v.vol_espaciamiento_m ?? v.espaciamiento_m ?? yac?.espaciamiento_m ?? null,
    });
    return {
      codigo: v.codigo,
      cantera: yac?.codigo ?? "?",
      perfFin: v.perf_fin,
      perfPozos: perf.pozos,
      perfMetros: perf.metros,
      perfMontoUsd: perf.metros != null && v.perf_precio_usd_m != null ? perf.metros * v.perf_precio_usd_m : null,
      perfMontoArs: montoPerforacion({
        metros: perf.metros,
        precioUsdM: v.perf_precio_usd_m,
        tc: v.perf_tc_usd,
        nochesSereno: v.perf_noches_sereno,
        montoNoche: v.perf_monto_noche,
      }),
      volFecha: v.vol_fecha,
      volTc: v.vol_tc_usd,
      // El informe reproduce el histórico de la planilla: usa la tonelada que
      // ella cargó cuando existe, y sólo cae en la fórmula de cantera para lo
      // que se cargue de acá en más y todavía no la tenga. Es distinto del
      // tablero de /cantera, que siempre muestra la calculada (y al lado, para
      // comparar, la de la planilla) — acá el objetivo es igualar el informe
      // que ya se escribía, no la operación del día a día.
      toneladas: v.toneladas_planilla ?? toneladasCalculadas,
      consumos: (consumosPorCodigo.get(v.codigo) ?? []).map((c) => ({
        tipo: c.tipo,
        cantidad: c.cantidad,
        precio_usd: c.precio_usd,
        insumo: c.insumo_raw ?? (c.insumo_id ? (nombreInsumoPorId.get(c.insumo_id) ?? null) : null),
      })),
    };
  });

  const bochones: BochonParaInforme[] = bs.map((b) => {
    const yac = porId.get(b.yacimiento_id) ?? null;
    const montoUsd =
      b.cantidad != null && b.metros_perforados != null && b.precio_usd_m != null
        ? b.cantidad * b.metros_perforados * b.precio_usd_m
        : null;
    return {
      codigo: b.codigo,
      cantera: yac?.codigo ?? "?",
      fecha: b.fecha_voladura ?? b.fin,
      cantidad: b.cantidad,
      metros: b.metros_perforados,
      montoUsd,
      montoArs: montoBochon({
        cantidad: b.cantidad,
        metrosPerforados: b.metros_perforados,
        precioUsdM: b.precio_usd_m,
        tc: b.tc_usd,
      }),
    };
  });

  return { voladuras, bochones };
}
