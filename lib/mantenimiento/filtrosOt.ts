/**
 * Los filtros del listado de órdenes de trabajo, leídos de la URL.
 *
 * Calcados de los de Compras, y por la misma razón: el listado tenía estado,
 * especialidad y un buscador, y con 1.819 órdenes eso no alcanza para llegar a
 * las que uno busca. «Las correctivas eléctricas de Filler 1 y Filler 2» son
 * tres preguntas que hoy hay que hacer en varias pasadas mirando la tabla.
 *
 * Cada filtro es una lista y no un valor: dentro de un filtro los valores suman
 * (o) y entre filtros se recortan (y). El caso que más se pide es el estado —
 * «qué hay abierto» es *Atrasado o En proceso o Por hacer*, y con un solo valor
 * por vez son tres pasadas para contar 36 órdenes sobre 1.819.
 *
 * La URL es el punto de entrada y también el de vuelta: el tablero enlaza acá
 * con `?estado=ATRASADO`, y al volver de una orden la tabla tiene que estar
 * como estaba.
 */

import {
  losQueEstanEnLaLista, escribirEnLaUrl, hayAlgunFiltro as hayAlguno,
} from "@/lib/core/filtrosUrl";
import { ESPECIALIDADES, ESTADOS_DE_OT } from "./ordenes";

/**
 * Los valores que la planilla usa en estas tres columnas.
 *
 * No son enums de la base —la columna es texto libre, porque el origen es una
 * planilla— así que la lista se declara acá y se la valida contra ella. Salen
 * de mirar las 1.819 órdenes cargadas: `tipo` tiene dos valores, `quien` dos, y
 * `prioridad` tres, todos escritos siempre igual.
 */
export const TIPOS_DE_OT = ["PROGRAMADO", "CORRECTIVO"] as const;
export const QUIENES_DE_OT = ["INTERNO", "CONTRATADO"] as const;

/**
 * La prioridad viene con el emoji adelante, tal cual la escribe la planilla:
 * "🟠 Alta". Se guarda así y se filtra así, porque cambiarla acá la separaría
 * de lo que dice la celda. Ver `pesoDePrioridad` en `prioridad.ts`, que sí
 * tiene que ignorarlo para poder ordenar.
 */
export const PRIORIDADES_DE_OT = ["🟠 Alta", "🟡 Media", "🟢 Baja"] as const;

export interface FiltrosOt {
  busqueda: string;
  estado: string[];
  especialidad: string[];
  tipo: string[];
  quien: string[];
  prioridad: string[];
  /**
   * El contratista, por su id de proveedor y no por el texto de la columna.
   * La 032 ya decidió que los contratistas son proveedores del núcleo, y las
   * 427 órdenes contratadas tienen el enlace puesto.
   */
  proveedor: string[];
  sector: string[];
  equipo: string[];
}

export const FILTROS_VACIOS: FiltrosOt = {
  busqueda: "", estado: [], especialidad: [], tipo: [], quien: [],
  prioridad: [], proveedor: [], sector: [], equipo: [],
};

/** Las listas contra las que se validan los filtros que son referencias. */
export interface CatalogosOt {
  sectores: string[];
  equipos: string[];
  proveedores: string[];
}

export function leerFiltrosDeLaUrl(
  params: URLSearchParams,
  catalogos: CatalogosOt
): FiltrosOt {
  return {
    busqueda: params.get("q")?.trim() ?? "",
    estado: losQueEstanEnLaLista(params, "estado", ESTADOS_DE_OT),
    especialidad: losQueEstanEnLaLista(params, "especialidad", ESPECIALIDADES),
    tipo: losQueEstanEnLaLista(params, "tipo", TIPOS_DE_OT),
    quien: losQueEstanEnLaLista(params, "quien", QUIENES_DE_OT),
    prioridad: losQueEstanEnLaLista(params, "prioridad", PRIORIDADES_DE_OT),
    proveedor: losQueEstanEnLaLista(params, "proveedor", catalogos.proveedores),
    sector: losQueEstanEnLaLista(params, "sector", catalogos.sectores),
    equipo: losQueEstanEnLaLista(params, "equipo", catalogos.equipos),
  };
}

/** Si hay algo puesto. Sirve para saber si la tabla vacía es por los filtros. */
export const hayAlgunFiltro = (f: FiltrosOt): boolean => hayAlguno(f);

/** El orden en que van los filtros en la URL, y con qué nombre. */
const NOMBRES: readonly [keyof FiltrosOt, string][] = [
  ["busqueda", "q"],
  ["estado", "estado"],
  ["especialidad", "especialidad"],
  ["tipo", "tipo"],
  ["quien", "quien"],
  ["prioridad", "prioridad"],
  ["proveedor", "proveedor"],
  ["sector", "sector"],
  ["equipo", "equipo"],
];

export const escribirFiltrosEnLaUrl = (f: FiltrosOt): string =>
  escribirEnLaUrl(f, NOMBRES);

/**
 * Los filtros como los espera la ruta.
 *
 * Es el mismo query string que la barra de direcciones, y a propósito: lo que
 * se puede pegar en el navegador es lo que la API entiende, así que reproducir
 * lo que alguien ve no requiere traducir nada. La paginación se agrega aparte
 * porque no es un filtro — no se comparte en un enlace, se descarta al cambiar
 * cualquier otra cosa.
 */
export function consultaDeLaRuta(f: FiltrosOt, pagina: number): string {
  const query = escribirFiltrosEnLaUrl(f);
  return query ? `${query}&page=${pagina}` : `page=${pagina}`;
}
