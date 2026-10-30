/**
 * La búsqueda del histórico, que encuentra las dos fuentes.
 *
 * Quien atiende un reclamo no tiene por qué saber de qué año es el dato antes de
 * buscarlo: el histórico del Excel y lo que Ensayos carga desde octubre salen
 * juntos, ordenados por fecha, cada uno con su marca.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import type { Muestra, Retenido } from "@/lib/calidad/ensayos/types";
import { aplanarMuestra, normalizarParaBuscar, type FilaDeLaBusqueda } from "./aplanar";
import type { Escala } from "./escala";

export interface Busqueda {
  /** Texto libre: un cliente, un producto, una determinación. Puede ir vacío. */
  texto: string;
  desde: string;
  hasta: string;
}

interface FilaDeLaTabla {
  fecha: string;
  hoja: string;
  origen_raw: string;
  determinacion: string;
  valor: number;
  escala: Escala;
  unidad: string | null;
  revisar: string | null;
  fila_excel: number;
}

/**
 * Lo que se midió entre dos fechas, de las dos fuentes.
 *
 * **El histórico se filtra en la base y no en memoria.** Son 3.511 filas hoy y
 * van a crecer poco, pero traerlas enteras para filtrarlas acá es el
 * `.limit(3000)` de este módulo: funciona hasta que deja de funcionar, y sin
 * avisar.
 *
 * El lado de Ensayos se acota por fecha antes de aplanarse —aplanar una muestra
 * cuesta tres cuentas y una granulometría— y recién ahí se filtra por texto,
 * porque sus determinaciones no existen como columna hasta que se las despeja.
 */
export async function buscar(
  supabase: SupabaseClient,
  { texto, desde, hasta }: Busqueda
): Promise<FilaDeLaBusqueda[]> {
  const termino = texto.trim();

  const delHistorico = await traerTodo<FilaDeLaTabla>((d, h) => {
    // La cadena del select va literal: armada en una variable, Supabase pierde
    // la inferencia y todo lo que sale queda como error de string.
    let q = supabase
      .from("calidad_historico_determinaciones")
      .select("fecha, hoja, origen_raw, determinacion, valor, escala, unidad, revisar, fila_excel")
      .gte("fecha", desde)
      .lte("fecha", hasta);
    if (termino) {
      q = q.or(`origen_raw.ilike.%${termino}%,determinacion.ilike.%${termino}%`);
    }
    return q.order("fecha", { ascending: false }).range(d, h);
  });

  const historico: FilaDeLaBusqueda[] = delHistorico.map((f) => ({
    fecha: f.fecha,
    origen: f.origen_raw,
    determinacion: f.determinacion,
    valor: Number(f.valor),
    escala: f.escala,
    unidad: f.unidad,
    fuente: "historico",
    revisar: f.revisar,
    fila_excel: f.fila_excel,
  }));

  const deEnsayos = await deEnsayosEnElRango(supabase, desde, hasta);

  // El filtro de texto de Ensayos corre acá: sus determinaciones no existen como
  // columna hasta que `aplanarMuestra` las despeja de los gramos.
  const aguja = normalizarParaBuscar(termino);
  const filtradas = aguja
    ? deEnsayos.filter(
        (f) =>
          normalizarParaBuscar(f.origen).includes(aguja) ||
          normalizarParaBuscar(f.determinacion).includes(aguja)
      )
    : deEnsayos;

  return [...historico, ...filtradas].sort(
    (a, b) => b.fecha.localeCompare(a.fecha) || a.origen.localeCompare(b.origen)
  );
}

/** Las muestras de Ensayos del rango, ya aplanadas. */
async function deEnsayosEnElRango(
  supabase: SupabaseClient,
  desde: string,
  hasta: string
): Promise<FilaDeLaBusqueda[]> {
  const muestras = await traerTodo<Muestra>((d, h) =>
    supabase
      .from("calidad_ensayos_muestras")
      .select("id, fecha, producto_id, observaciones, humedad_p_recipiente, humedad_p_inicial, humedad_p_final, peso_vol_gramos, peso_vol_volumen_cc, cal_util_ml_acido, cal_util_peso_muestra_g, granulometria_peso_muestra_g, cargado_por, cargado_en, actualizado_por, actualizado_en")
      .gte("fecha", desde)
      .lte("fecha", hasta)
      .range(d, h)
  );
  if (muestras.length === 0) return [];

  const productos = await traerTodo<{ id: string; nombre: string }>((d, h) =>
    supabase.from("calidad_ensayos_productos").select("id, nombre").range(d, h)
  );
  const nombreDe = new Map(productos.map((p) => [p.id, p.nombre]));

  // Los retenidos se traen por rango de fecha a través de su muestra y no con un
  // `.in()` de ids: con muchas muestras esa URL es la que PostgREST rechaza con
  // un 400 sin decir por qué.
  // El embed vuelve como arreglo aunque la relación sea de uno a uno: es la
  // forma que devuelve PostgREST y tiparlo como objeto no compila.
  const retenidos = await traerTodo<Retenido & { calidad_ensayos_muestras: { fecha: string }[] }>((d, h) =>
    supabase
      .from("calidad_ensayos_retenidos")
      .select("muestra_id, malla, retenido_g, calidad_ensayos_muestras!inner(fecha)")
      .gte("calidad_ensayos_muestras.fecha", desde)
      .lte("calidad_ensayos_muestras.fecha", hasta)
      .range(d, h)
  );

  const porMuestra = new Map<string, Retenido[]>();
  for (const r of retenidos) {
    porMuestra.set(r.muestra_id, [...(porMuestra.get(r.muestra_id) ?? []), r]);
  }

  return muestras.flatMap((m) =>
    aplanarMuestra(m, porMuestra.get(m.id) ?? [], nombreDe.get(m.producto_id) ?? "—")
  );
}
