import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { valorHoraDe } from "@/lib/rrhh/valorHora";
import { montoBochon, montoPerforacion } from "./costos";
import { toneladasEstimadas } from "./toneladas";
import { metrosYPozos } from "./tramos";
import type { PesadaAgrupada } from "./pesadas";
import type { BochonParaInforme, VoladuraParaInforme } from "./informe";
import type { AcarreoDB, Bochon, Consumo, CubicacionDB, DestapeDB, Fletero, Insumo, PesadaDB, TarifaAcarreoDB, Voladura, Yacimiento } from "./types";

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

export interface DatosParaInforme {
  voladuras: VoladuraParaInforme[];
  bochones: BochonParaInforme[];
  /**
   * Lo crudo, para el caller que además necesita otra vista de lo mismo (el
   * adelanto de "Registros" en `app/(app)/cantera/page.tsx`) y así no tiene
   * que volver a pedirlo — antes esa página traía voladuras, bochones y
   * consumos DOS VECES cada uno (una directo, otra acá adentro), el doble
   * de viajes de red de los que hacían falta.
   */
  voladurasCrudas: Voladura[];
  bochonesCrudos: Bochon[];
  /** Todos los yacimientos (no sólo los activos): un yacimiento desactivado no deja de tener voladuras históricas que mostrar. */
  yacimientos: Yacimiento[];
  consumos: Consumo[];
}

/**
 * Todo lo que necesita `lib/cantera/informe.ts`, ya armado desde la base: las
 * voladuras (con sus consumos) y los bochones, con los montos y las toneladas
 * despejados. La usan la pantalla del informe y su export a Excel — una sola
 * vez, para que las dos miren exactamente lo mismo.
 */
export async function traerDatosParaInforme(supabase: SupabaseClient): Promise<DatosParaInforme> {
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

  return { voladuras, bochones, voladurasCrudas: vs, bochonesCrudos: bs, yacimientos, consumos };
}

// ── Acarreo (fase 2) ─────────────────────────────────────────

export async function traerFleteros(supabase: SupabaseClient, soloActivos = false): Promise<Fletero[]> {
  let consulta = supabase.from("cantera_fleteros").select("id, nombre, patente, activo").order("nombre");
  if (soloActivos) consulta = consulta.eq("activo", true);
  const { data, error } = await consulta;
  if (error) throw new Error(error.message);
  return (data ?? []) as Fletero[];
}

export async function traerTarifasAcarreo(supabase: SupabaseClient): Promise<TarifaAcarreoDB[]> {
  const { data, error } = await supabase
    .from("cantera_tarifas_acarreo")
    .select("id, tipo, desde, hasta, tarifa")
    .order("tipo")
    .order("desde");
  if (error) throw new Error(error.message);
  return (data ?? []) as TarifaAcarreoDB[];
}

export interface FiltrosDeAcarreo {
  fleteroId?: string;
  tipo?: string;
  /** "YYYY-MM": trae ese mes de calendario completo. */
  mes?: string;
  /** "YYYY": trae ese año calendario completo. Se ignora si también viene `mes`. */
  anio?: string;
}

/** Una fila por fletero+tipo+día (`unique(fletero_id, tipo, fecha)` desde el 21/09/2026) — puede haber varias del mismo fletero+tipo en un mes, una por día cargado. */
export async function traerAcarreos(
  supabase: SupabaseClient,
  filtros: FiltrosDeAcarreo = {}
): Promise<AcarreoDB[]> {
  return traerTodo<AcarreoDB>((desde, hasta) => {
    let q = supabase
      .from("cantera_acarreos")
      .select(
        "id, fletero_id, tipo, fecha, mes, cantidad, observaciones, origen, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en"
      );
    if (filtros.fleteroId) q = q.eq("fletero_id", filtros.fleteroId);
    if (filtros.tipo) q = q.eq("tipo", filtros.tipo);
    if (filtros.mes) {
      const [anio, mesNum] = filtros.mes.split("-").map(Number);
      const primerDia = `${filtros.mes}-01`;
      const ultimoDia = new Date(Date.UTC(anio, mesNum, 0)).toISOString().slice(0, 10);
      q = q.gte("mes", primerDia).lte("mes", ultimoDia);
    } else if (filtros.anio) {
      q = q.gte("mes", `${filtros.anio}-01-01`).lte("mes", `${filtros.anio}-12-31`);
    }
    return q.order("fecha", { ascending: false }).order("tipo").range(desde, hasta);
  });
}

export interface FiltrosDePesadas {
  fleteroId?: string;
  /** "YYYY-MM": trae ese mes de calendario completo. */
  mes?: string;
  /** "YYYY": trae ese año calendario completo. Se ignora si también viene `mes`. */
  anio?: string;
}

/** Las pesadas de balanza, ya resueltas — de acá sale el material acarreado por fletero. */
export async function traerPesadas(
  supabase: SupabaseClient,
  filtros: FiltrosDePesadas = {}
): Promise<PesadaDB[]> {
  return traerTodo<PesadaDB>((desde, hasta) => {
    let q = supabase
      .from("cantera_pesadas")
      .select("id, fecha, hora, bruto, tara, tipo, toneladas, origen, destino, fletero_raw, fletero_id");
    if (filtros.fleteroId) q = q.eq("fletero_id", filtros.fleteroId);
    if (filtros.mes) {
      const [anio, mesNum] = filtros.mes.split("-").map(Number);
      const primerDia = `${filtros.mes}-01`;
      const ultimoDia = new Date(Date.UTC(anio, mesNum, 0)).toISOString().slice(0, 10);
      q = q.gte("fecha", primerDia).lte("fecha", ultimoDia);
    } else if (filtros.anio) {
      q = q.gte("fecha", `${filtros.anio}-01-01`).lte("fecha", `${filtros.anio}-12-31`);
    }
    return q.order("fecha").range(desde, hasta);
  });
}

interface FilaPromedioToneladas {
  fletero_id: string;
  promedio: number;
  cantidad: number;
}

/**
 * Toneladas promedio por viaje, por fletero, sobre toda su historia de
 * pesadas — mismo resultado que `toneladasPromedioPorFletero()`
 * (`lib/cantera/destape.ts`) aplicada sobre `traerPesadas(supabase)` sin
 * filtro, pero calculado en la base (`cantera_promedio_toneladas_por_fletero()`,
 * migración `20260922092048`) en vez de traer las 7623+ filas a la app para
 * promediarlas acá. Reemplaza ese camino en Destape, que es el único lugar
 * que necesitaba el promedio de toda la historia.
 *
 * Si la función todavía no existe en la base (falta correr la migración) o
 * el pedido falla, devuelve `{}` en vez de romper la página: Destape ya
 * sabe mostrar "sin estimar" cuando un fletero no tiene promedio
 * (`costoDeRegistro` en `lib/cantera/destape.ts`), así que un caché vacío es
 * degradar, no romper — mismo criterio que `costoHoraDeMaquinasDelMes` con
 * un hipo de Odoo.
 */
export async function traerPromedioToneladasPorFletero(
  supabase: SupabaseClient
): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc("cantera_promedio_toneladas_por_fletero");
  if (error) {
    console.error("traerPromedioToneladasPorFletero: no se pudo calcular, Destape sigue sin toneladas estimadas", error);
    return {};
  }
  return Object.fromEntries(
    ((data ?? []) as FilaPromedioToneladas[]).map((f) => [f.fletero_id, f.promedio])
  );
}

interface FilaPesadaAgrupadaDB {
  fletero_id: string | null;
  tipo: string;
  mes: string;
  toneladas: number;
}

/**
 * Las pesadas de un año, ya sumadas por fletero+tipo+mes en la base
 * (`cantera_pesadas_por_fletero_tipo_mes()`, migración `20260922093520`) —
 * reemplaza a `traerPesadas(supabase, { anio })` para el "Resumen anual" de
 * Cantera (`ResumenAnualSection.tsx`): como TODAS las pesadas de la base son
 * del año en curso (verificado el 22/09/2026), filtrar por año no achicaba
 * nada — era traer la tabla entera (7623+ filas, 8 páginas) igual. Acá es
 * un puñado de filas (fletero × tipo × mes).
 *
 * Igual que `traerPromedioToneladasPorFletero`: si la función no existe
 * todavía o el pedido falla, devuelve `[]` en vez de romper la página — el
 * Resumen anual queda en $0/vacío por ese año hasta que se pueda calcular
 * de nuevo, no cae la página.
 */
export async function traerPesadasAgrupadasPorFleteroTipoMes(
  supabase: SupabaseClient,
  anio: string
): Promise<PesadaAgrupada[]> {
  const { data, error } = await supabase.rpc("cantera_pesadas_por_fletero_tipo_mes", { p_anio: anio });
  if (error) {
    console.error("traerPesadasAgrupadasPorFleteroTipoMes: no se pudo calcular, el Resumen anual queda vacío para este año", error);
    return [];
  }
  return ((data ?? []) as FilaPesadaAgrupadaDB[]).map((f) => ({
    fleteroId: f.fletero_id,
    tipo: f.tipo,
    mes: f.mes,
    toneladas: f.toneladas,
  }));
}

interface FilaPesadaPorOrigenMesDB {
  origen: string;
  mes: string;
  toneladas: number;
}

/**
 * Las pesadas de TODA la historia, ya sumadas por yacimiento (D1/D6/C1/C3) +
 * mes en la base (`cantera_pesadas_por_origen_mes()`, migración
 * `20260922105016`) — reemplaza a `traerPesadas(supabase, {})` sin filtro
 * para Cubicación (`/cantera/cubicacion`), que necesita el historial
 * completo (no se puede acotar por año: `armarCierresCubicacion` encadena
 * la existencia inicial de cada mes con la final del anterior). El usuario
 * reportó no poder entrar a esa página — eran las mismas 8 páginas de
 * `cantera_pesadas` que ya costaron en Destape y el Resumen anual.
 *
 * Mismo criterio de degradar sin romper: si la función no existe todavía o
 * falla, devuelve `[]` — Cubicación queda sin acarreo calculado (el resto
 * del balance sigue viéndose), no se cae la página.
 */
export async function traerPesadasAgrupadasPorOrigenMes(
  supabase: SupabaseClient
): Promise<{ yacimientoCodigo: string; mes: string; toneladas: number }[]> {
  const { data, error } = await supabase.rpc("cantera_pesadas_por_origen_mes");
  if (error) {
    console.error("traerPesadasAgrupadasPorOrigenMes: no se pudo calcular, Cubicación queda sin acarreo para este período", error);
    return [];
  }
  return ((data ?? []) as FilaPesadaPorOrigenMesDB[]).map((f) => ({
    yacimientoCodigo: f.origen,
    // La función SQL devuelve `date` ("YYYY-MM-01"): `AcarreoPorYacimiento.mes`
    // es "YYYY-MM" y `armarCierresCubicacion` lo compara con `===` — sin este
    // recorte, la comparación nunca matchea y el acarreo queda en 0 siempre,
    // sin ningún error que lo avise.
    mes: f.mes.slice(0, 7),
    toneladas: f.toneladas,
  }));
}

/**
 * Todos los cierres de cubicación cargados, de todos los yacimientos y
 * meses — la tabla es chica (un yacimiento × un mes por fila) y
 * `armarCierresCubicacion` (`./cubicacion.ts`) necesita el historial
 * completo para encadenar la existencia inicial mes a mes, no sólo el mes
 * que se está mirando.
 */
export async function traerCubicaciones(supabase: SupabaseClient): Promise<CubicacionDB[]> {
  return traerTodo<CubicacionDB>((desde, hasta) =>
    supabase
      .from("cantera_cubicaciones")
      .select("id, yacimiento_id, mes, existencia_final, observaciones, cargado_por, cargado_en, actualizado_por, actualizado_en")
      .order("mes")
      .range(desde, hasta)
  );
}

export interface FiltrosDeDestape {
  /** "YYYY-MM-DD" */
  desde?: string;
  /** "YYYY-MM-DD" */
  hasta?: string;
  yacimientoCodigo?: string;
}

export async function traerDestape(supabase: SupabaseClient, filtros: FiltrosDeDestape = {}): Promise<DestapeDB[]> {
  return traerTodo<DestapeDB>((desde, hasta) => {
    let q = supabase
      .from("cantera_destape")
      .select("id, fecha, yacimiento_codigo, frente, tipo_recurso, operario_id, fletero_id, recurso_raw, equipo_id, equipo_o_vehiculo_raw, tipo_camion, horas, viajes, observaciones, origen, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en");
    if (filtros.desde) q = q.gte("fecha", filtros.desde);
    if (filtros.hasta) q = q.lte("fecha", filtros.hasta);
    if (filtros.yacimientoCodigo) q = q.eq("yacimiento_codigo", filtros.yacimientoCodigo);
    return q.order("fecha", { ascending: false }).range(desde, hasta);
  });
}

export interface EmpleadoLiviano {
  id: string;
  nombre: string;
  apellido: string;
  /** `rrhh_empleados_datos.valor_hora_normal` — lo que vale la mano de obra propia de este operario en Destape (ya no es una tarifa "mo_propia" única). */
  valorHoraNormal: number;
}

/**
 * Los operarios para el selector de Destape: sólo los del sector "Cantera y
 * Planta de Trituración" (por nombre, no un id fijo — mismo criterio que
 * `traerOperariosDeTrituracion` de `lib/trituracion/consultas.ts`, que
 * filtra el mismo sector desde el otro módulo). No se comparte la función
 * entre los dos: Trituración depender de Cantera tiene sentido (Cantera es
 * upstream), al revés no.
 */
export async function traerOperariosDeCantera(supabase: SupabaseClient): Promise<EmpleadoLiviano[]> {
  const { data: sectores, error: errSectores } = await supabase
    .from("sectores")
    .select("id, nombre")
    .or("nombre.ilike.%cantera%,nombre.ilike.%tritura%");
  if (errSectores) throw new Error(errSectores.message);

  const sectorIds = (sectores ?? []).map((s) => s.id as string);
  if (sectorIds.length === 0) return [];

  // El valor hora sale de `rrhh_empleados_datos` y no de `empleados`: se mudó
  // el 22/09/2026 porque `empleados` es un catálogo del núcleo con la lectura
  // abierta a cualquier autenticado, y un sueldo por hora no es dato de
  // catálogo (ver la migración 20260922101405 y `lib/rrhh/valorHora.ts`).
  //
  // Esto lee un dato de RRHH desde Cantera, así que **depende de que quien
  // mire Destape tenga acceso a RRHH**: `rrhh_empleados_datos` está cerrada con
  // `tiene_acceso_rrhh()` desde la 009. A quien no lo tenga, el embed le llega
  // vacío y el valor hora es 0 — no rompe la pantalla, pero el costo de mano de
  // obra propia le da cero. Queda anotado porque es una decisión de permisos
  // que no se ve desde acá: si Destape tiene que mostrarle el costo a alguien
  // sin RRHH, lo que hay que resolver es de dónde sale ese número, no aflojar
  // la policy.
  const { data, error } = await supabase
    .from("empleados")
    .select("id, nombre, apellido, rrhh_empleados_datos(valor_hora_normal)")
    .eq("activo", true)
    .in("sector_id", sectorIds)
    .order("apellido", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((e) => ({
    id: e.id as string,
    nombre: e.nombre as string,
    apellido: e.apellido as string,
    valorHoraNormal: valorHoraDe(e),
  }));
}
