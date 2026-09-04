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
  losQueEstanEnLaLista, escribirEnLaUrl, conLaPagina, hayAlgunFiltro as hayAlguno,
} from "@/lib/core/filtrosUrl";
import { fechaDeTexto } from "@/lib/core/fechas";
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

/**
 * Sobre qué fecha corre el rango.
 *
 * Una orden tiene tres y no son la misma pregunta: **cuándo se emitió**
 * (`fecha`), **cuándo se hizo o se va a hacer** (`fecha_ejecucion`) y **cuándo
 * se cerró** (`fecha_cierre`). Las tres están cargadas —1.818, 1.818 y 1.566 de
 * 1.819— y elegir una por nosotros sería contestar otra cosa: "las de agosto"
 * da 180 por emisión y 195 por ejecución, y quien pregunta sabe cuál quiere.
 *
 * El default es `fecha`, que es la que la tabla muestra y la más completa.
 */
export const CAMPOS_DE_FECHA = [
  ["", "Fecha de la orden"],
  ["fecha_ejecucion", "Fecha de ejecución"],
  ["fecha_cierre", "Fecha de cierre"],
] as const;

const CAMPOS_VALIDOS: readonly string[] = CAMPOS_DE_FECHA.map(([v]) => v);

/**
 * La columna que hay que filtrar. Lo que no está en la lista cae en `fecha`.
 *
 * La lista blanca vive **acá y no en la ruta**, aunque sea la ruta la que
 * arma la consulta: es un nombre de columna que viene de la URL, y dejar que
 * quien lo use se acuerde de validarlo es cómo alguna vez no se acuerda. Así
 * la función es segura sola y se puede probar.
 */
export function columnaDeFecha(campo: string | null | undefined): string {
  const elegido = String(campo ?? "");
  return elegido && CAMPOS_VALIDOS.includes(elegido) ? elegido : "fecha";
}

/**
 * Una fecha de la URL, o `""`.
 *
 * Se valida con el mismo parser que el resto del sistema, que descarta el 31 de
 * febrero en vez de convertirlo en 3 de marzo. Una fecha imposible en la URL
 * dejaría la tabla vacía sin que se vea por qué.
 */
const laFecha = (params: URLSearchParams, nombre: string): string =>
  fechaDeTexto(params.get(nombre)) ?? "";

export interface FiltrosOt {
  busqueda: string;
  /** Sobre cuál de las tres fechas corre el rango. `""` es `fecha`. */
  campoFecha: string;
  /** "YYYY-MM-DD", los dos inclusive. `""` es sin límite de ese lado. */
  desde: string;
  hasta: string;
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
  busqueda: "", campoFecha: "", desde: "", hasta: "",
  estado: [], especialidad: [], tipo: [], quien: [],
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
    // Se guarda "" cuando es la de siempre: así el desplegable arranca en su
    // primera opción y el parámetro no viaja de más.
    campoFecha: CAMPOS_VALIDOS.includes(params.get("campo_fecha") ?? "")
      ? params.get("campo_fecha") ?? ""
      : "",
    desde: laFecha(params, "desde"),
    hasta: laFecha(params, "hasta"),
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

/**
 * Si hay algo puesto. Sirve para saber si la tabla vacía es por los filtros.
 *
 * `campoFecha` no cuenta: elegir "fecha de cierre" sin poner ningún día no
 * filtra nada, y hacerlo contar dejaría el cartel diciendo que hay filtros
 * cuando no los hay.
 */
export const hayAlgunFiltro = (f: FiltrosOt): boolean =>
  hayAlguno({ ...f, campoFecha: "" });

/** El orden en que van los filtros en la URL, y con qué nombre. */
const NOMBRES: readonly [keyof FiltrosOt, string][] = [
  ["busqueda", "q"],
  ["campoFecha", "campo_fecha"],
  ["desde", "desde"],
  ["hasta", "hasta"],
  ["estado", "estado"],
  ["especialidad", "especialidad"],
  ["tipo", "tipo"],
  ["quien", "quien"],
  ["prioridad", "prioridad"],
  ["proveedor", "proveedor"],
  ["sector", "sector"],
  ["equipo", "equipo"],
];

/**
 * Sin fechas puestas, `campoFecha` no viaja: no filtra nada y ensuciaría el
 * enlace que alguien copia con un parámetro que no hace nada.
 */
/**
 * Los filtros, y en qué página está parado el listado, como query string.
 *
 * La página se cuenta desde uno, igual que en la URL y que en los botones de
 * abajo de la tabla; acá adentro también, así que no hay nada que convertir, y
 * la primera no se escribe. Sin ella, entrar a una orden desde la página 3 y
 * volver dejaba la tabla filtrada pero cien filas más arriba de donde se
 * estaba.
 */
export const escribirFiltrosEnLaUrl = (f: FiltrosOt, pagina = 1): string =>
  conLaPagina(
    escribirEnLaUrl(f.desde || f.hasta ? f : { ...f, campoFecha: "" }, NOMBRES),
    pagina
  );

/**
 * Los filtros como los espera la ruta.
 *
 * Es el mismo query string que la barra de direcciones, y a propósito: lo que
 * se puede pegar en el navegador es lo que la API entiende, así que reproducir
 * lo que alguien ve no requiere traducir nada.
 *
 * La página se agrega aparte, con el nombre que espera la ruta y siempre,
 * aunque sea la primera. En la barra de direcciones va como `pagina` y sólo
 * cuando no es la primera: son dos cosas parecidas con reglas distintas, una
 * para pedirle datos al servidor y otra para que un enlace se pueda leer y
 * compartir. Por eso acá se piden los filtros sin página y se pega la propia.
 */
export function consultaDeLaRuta(f: FiltrosOt, pagina: number): string {
  const query = escribirFiltrosEnLaUrl(f);
  return query ? `${query}&page=${pagina}` : `page=${pagina}`;
}
