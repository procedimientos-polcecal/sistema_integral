import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import type { Limite, Muestra, ProductoDeEnsayo, Retenido } from "./types";

/**
 * Las lecturas del frente de ensayos.
 *
 * **Todo con `traerTodo()`.** PostgREST corta en 1000 filas y no avisa: un
 * `.limit(3000)` devuelve 1000. El Excel que esto reemplaza trae 623 muestras
 * de tres años y el laboratorio carga entre una y tres por día, así que la
 * tabla de muestras cruza el corte dentro del primer año — y la de retenidos,
 * con hasta diez filas por muestra, en meses. No razonar "esta tabla es chica".
 *
 * El `select()` va literal en cada función: armarlo en una variable pierde la
 * inferencia de tipos de Supabase.
 */

export async function traerProductos(supabase: SupabaseClient): Promise<ProductoDeEnsayo[]> {
  return traerTodo<ProductoDeEnsayo>((desde, hasta) =>
    supabase
      .from("calidad_ensayos_productos")
      .select("id, nombre, grupo, orden, mallas, activo")
      .order("orden")
      .range(desde, hasta)
  );
}

export async function traerLimites(supabase: SupabaseClient): Promise<Limite[]> {
  return traerTodo<Limite>((desde, hasta) =>
    supabase
      .from("calidad_ensayos_limites")
      .select("id, producto_id, determinacion, malla, minimo, maximo")
      .order("determinacion")
      .order("malla")
      .range(desde, hasta)
  );
}

/**
 * Las muestras desde una fecha, de la más nueva a la más vieja.
 *
 * El desempate es `cargado_en` y no el id: dos muestras del mismo producto el
 * mismo día son un caso real —28 de las 29 fechas repetidas de la hoja `Cal` lo
 * son— y se leen en el orden en que se cargaron.
 */
export async function traerMuestras(
  supabase: SupabaseClient,
  desdeFecha: string
): Promise<Muestra[]> {
  return traerTodo<Muestra>((desde, hasta) =>
    supabase
      .from("calidad_ensayos_muestras")
      .select(
        "id, fecha, producto_id, observaciones, humedad_p_recipiente, humedad_p_inicial, humedad_p_final, peso_vol_gramos, peso_vol_volumen_cc, cal_util_ml_acido, cal_util_peso_muestra_g, granulometria_peso_muestra_g, cargado_por, cargado_en, actualizado_por, actualizado_en"
      )
      .gte("fecha", desdeFecha)
      .order("fecha", { ascending: false })
      .order("cargado_en", { ascending: false })
      .range(desde, hasta)
  );
}

/**
 * Las muestras de **un solo día**, para el reporte.
 *
 * Es una consulta aparte y no `traerMuestras` filtrado después: pedir un día de
 * hace seis meses se traería todo lo cargado desde entonces para quedarse con
 * tres filas.
 */
export async function traerMuestrasDelDia(
  supabase: SupabaseClient,
  fecha: string
): Promise<Muestra[]> {
  return traerTodo<Muestra>((desde, hasta) =>
    supabase
      .from("calidad_ensayos_muestras")
      .select(
        "id, fecha, producto_id, observaciones, humedad_p_recipiente, humedad_p_inicial, humedad_p_final, peso_vol_gramos, peso_vol_volumen_cc, cal_util_ml_acido, cal_util_peso_muestra_g, granulometria_peso_muestra_g, cargado_por, cargado_en, actualizado_por, actualizado_en"
      )
      .eq("fecha", fecha)
      .order("cargado_en")
      .range(desde, hasta)
  );
}

/**
 * El último día que tiene alguna muestra cargada.
 *
 * El reporte se abre parado ahí y no en hoy: a la mañana, antes del primer
 * ensayo, "hoy" es una pantalla vacía que parece un error.
 */
export async function ultimoDiaConMuestras(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase
    .from("calidad_ensayos_muestras")
    .select("fecha")
    .order("fecha", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.fecha ?? null;
}

/**
 * Los retenidos de las muestras desde una fecha.
 *
 * **Filtra por la fecha de la muestra y no con un `.in()` de ids.** Un `.in()`
 * con muchos ids arma una URL que PostgREST rechaza con un 400 sin decir por
 * qué, y acá un semestre son fácil cuatrocientas muestras.
 */
export async function traerRetenidos(
  supabase: SupabaseClient,
  desdeFecha: string
): Promise<Retenido[]> {
  const filas = await traerTodo<Retenido & { calidad_ensayos_muestras: unknown }>((desde, hasta) =>
    supabase
      .from("calidad_ensayos_retenidos")
      .select("muestra_id, malla, retenido_g, calidad_ensayos_muestras!inner(fecha)")
      .gte("calidad_ensayos_muestras.fecha", desdeFecha)
      .order("malla")
      .range(desde, hasta)
  );

  // El embed viajó sólo para poder filtrar por la fecha de la muestra; de acá
  // en más estorba.
  return filas.map(({ muestra_id, malla, retenido_g }) => ({ muestra_id, malla, retenido_g }));
}

/** Una muestra y sus retenidos, para la pantalla de detalle. */
export async function traerMuestra(
  supabase: SupabaseClient,
  id: string
): Promise<{ muestra: Muestra; retenidos: Retenido[] } | null> {
  const { data: muestra } = await supabase
    .from("calidad_ensayos_muestras")
    .select(
      "id, fecha, producto_id, observaciones, humedad_p_recipiente, humedad_p_inicial, humedad_p_final, peso_vol_gramos, peso_vol_volumen_cc, cal_util_ml_acido, cal_util_peso_muestra_g, granulometria_peso_muestra_g, cargado_por, cargado_en, actualizado_por, actualizado_en"
    )
    .eq("id", id)
    .maybeSingle();

  if (!muestra) return null;

  const { data: retenidos } = await supabase
    .from("calidad_ensayos_retenidos")
    .select("muestra_id, malla, retenido_g")
    .eq("muestra_id", id)
    .order("malla");

  return { muestra: muestra as Muestra, retenidos: (retenidos ?? []) as Retenido[] };
}
