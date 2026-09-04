/**
 * Los filtros de las cuatro pantallas de Inventario, leídos y escritos en la URL.
 *
 * Mismo motivo que en Compras y en Mantenimiento: los filtros vivían sólo en
 * memoria, así que cargar el kardex, acotarlo a las salidas de un sector entre
 * dos fechas, entrar a cargar un movimiento y volver devolvía los 3.400
 * movimientos sin filtrar. Y un enlace a "las salidas de septiembre" no se
 * podía mandar por chat, que es como se pasa la mitad de estas preguntas.
 *
 * Cómo se lee y se escribe cada valor lo decide `lib/core/filtrosUrl.ts`. Acá
 * está sólo qué se filtra en cada pantalla y contra qué se valida.
 *
 * A diferencia de los otros dos módulos, estos filtros son de un valor y no
 * listas: los desplegables son de una sola opción y no hay pedido de que sean
 * varias. Si aparece, el cambio es del lado de acá y no del núcleo, que ya
 * escribe listas separadas por comas.
 */

import { fechaDeTexto } from "@/lib/core/fechas";
import {
  escribirEnLaUrl, conLaPagina, elSiONo, hayAlgunFiltro as hayAlguno,
} from "@/lib/core/filtrosUrl";

/** Los tres tipos de movimiento del kardex. */
export const TIPOS_DE_MOVIMIENTO = ["entrada", "salida", "ajuste"] as const;

/**
 * De dónde salió el movimiento.
 *
 * Es el filtro que importa: distingue lo que se cargó en el sistema de lo que
 * vino de la planilla, y sin eso no se puede saber por dónde entra el trabajo
 * ni si la app se está usando.
 */
export const ORIGENES_DE_MOVIMIENTO = ["app", "planilla"] as const;

/** Un valor de un desplegable de una sola opción: el que está en la lista, o "". */
function elQueEstaEnLaLista(
  params: URLSearchParams,
  nombre: string,
  permitidos: readonly string[]
): string {
  const valor = params.get(nombre)?.trim() ?? "";
  // Uno que no está se descarta en silencio, igual que en los otros módulos: un
  // filtro que la persona no ve —porque el desplegable no tiene esa opción— y
  // no puede quitar deja una tabla vacía que se lee como "no hay nada".
  return permitidos.includes(valor) ? valor : "";
}

/**
 * Una fecha de la URL, o "".
 *
 * Con el mismo parser que el resto del sistema, que descarta el 31 de febrero
 * en vez de convertirlo en 3 de marzo. Una fecha imposible en la URL dejaría el
 * kardex vacío sin que se vea por qué.
 */
const laFecha = (params: URLSearchParams, nombre: string): string =>
  fechaDeTexto(params.get(nombre)) ?? "";

// ============================================================
// El kardex: /inventario/movimientos
// ============================================================

export interface FiltrosMovimientos {
  /** Por código de artículo, y por el principio: la consulta es `ilike 'abc%'`. */
  busqueda: string;
  tipo: string;
  origen: string;
  /** Id del sector, del catálogo del núcleo. */
  sector: string;
  /** "YYYY-MM-DD", los dos inclusive. "" es sin límite de ese lado. */
  desde: string;
  hasta: string;
}

export const MOVIMIENTOS_SIN_FILTROS: FiltrosMovimientos = {
  busqueda: "", tipo: "", origen: "", sector: "", desde: "", hasta: "",
};

export function leerFiltrosDeMovimientos(
  params: URLSearchParams,
  sectores: readonly string[]
): FiltrosMovimientos {
  return {
    busqueda: params.get("q")?.trim() ?? "",
    tipo: elQueEstaEnLaLista(params, "tipo", TIPOS_DE_MOVIMIENTO),
    origen: elQueEstaEnLaLista(params, "origen", ORIGENES_DE_MOVIMIENTO),
    sector: elQueEstaEnLaLista(params, "sector", sectores),
    desde: laFecha(params, "desde"),
    hasta: laFecha(params, "hasta"),
  };
}

/** El orden en que van los filtros en la URL, y con qué nombre. */
const NOMBRES_MOVIMIENTOS: readonly [keyof FiltrosMovimientos, string][] = [
  ["busqueda", "q"],
  ["tipo", "tipo"],
  ["origen", "origen"],
  ["sector", "sector"],
  ["desde", "desde"],
  ["hasta", "hasta"],
];

/**
 * Los filtros y la página, como query string sin el `?`.
 *
 * La página se cuenta desde uno, igual que en la URL y que en los botones de
 * abajo de la tabla, y la primera no se escribe. Adentro el kardex la cuenta
 * desde cero porque así se calcula el `range()`; convierte en el borde con
 * `paginaDeArranque`.
 */
export const escribirFiltrosDeMovimientos = (
  f: FiltrosMovimientos,
  pagina = 1
): string => conLaPagina(escribirEnLaUrl(f, NOMBRES_MOVIMIENTOS), pagina);

/** Si hay algo puesto. Sirve para saber si la tabla vacía es por los filtros. */
export const hayFiltrosDeMovimientos = (f: FiltrosMovimientos): boolean =>
  hayAlguno(f);

// ============================================================
// El stock del pañol: /inventario
// ============================================================

export interface FiltrosStock {
  busqueda: string;
  /** Sólo los que están por debajo del stock de seguridad. */
  soloFaltantes: boolean;
}

export const STOCK_SIN_FILTROS: FiltrosStock = { busqueda: "", soloFaltantes: false };

/**
 * Los nombres son los que la pantalla ya le mandaba a la API —`q` y
 * `faltantes=1`—, así que lo que se ve en la barra de direcciones es lo mismo
 * que viaja en la consulta. Un nombre distinto de cada lado obliga a traducir
 * para reproducir lo que alguien está viendo.
 */
const NOMBRES_STOCK: readonly [keyof FiltrosStock, string][] = [
  ["busqueda", "q"],
  ["soloFaltantes", "faltantes"],
];

export function leerFiltrosDeStock(params: URLSearchParams): FiltrosStock {
  return {
    busqueda: params.get("q")?.trim() ?? "",
    soloFaltantes: elSiONo(params, "faltantes"),
  };
}

export const escribirFiltrosDeStock = (f: FiltrosStock): string =>
  escribirEnLaUrl(f, NOMBRES_STOCK);

// ============================================================
// El catálogo: /inventario/articulos
// ============================================================

/**
 * Acá el único filtro es el buscador, y la URL igual sirve: la pantalla se usa
 * para ir a buscar un artículo puntual, y `?q=rodamiento` es lo que se recarga
 * o se manda por chat.
 */
export interface FiltrosArticulos {
  busqueda: string;
}

export const ARTICULOS_SIN_FILTROS: FiltrosArticulos = { busqueda: "" };

const NOMBRES_ARTICULOS: readonly [keyof FiltrosArticulos, string][] = [
  ["busqueda", "q"],
];

export function leerFiltrosDeArticulos(params: URLSearchParams): FiltrosArticulos {
  return { busqueda: params.get("q")?.trim() ?? "" };
}

export const escribirFiltrosDeArticulos = (f: FiltrosArticulos): string =>
  escribirEnLaUrl(f, NOMBRES_ARTICULOS);

// ============================================================
// La lista del pañol: /inventario/lista
// ============================================================

/**
 * Un solo filtro, y de sí o no, pero decide qué filas se ven: sin él la
 * pantalla esconde los dados de baja. Recargar para ver por qué "no está" un
 * solicitante que en realidad está inactivo era el paso que había que repetir
 * cada vez, y `?inactivos=1` es lo que se manda por chat para mostrarlo.
 */
export interface FiltrosLista {
  verInactivos: boolean;
}

export const LISTA_SIN_FILTROS: FiltrosLista = { verInactivos: false };

const NOMBRES_LISTA: readonly [keyof FiltrosLista, string][] = [
  ["verInactivos", "inactivos"],
];

export function leerFiltrosDeLista(params: URLSearchParams): FiltrosLista {
  return { verInactivos: elSiONo(params, "inactivos") };
}

export const escribirFiltrosDeLista = (f: FiltrosLista): string =>
  escribirEnLaUrl(f, NOMBRES_LISTA);
