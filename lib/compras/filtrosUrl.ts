import { ESTADOS_APROBACION, ESTADOS_COMPRA, PRIORIDADES } from "./constants";

/**
 * Los filtros del listado, leídos de la URL.
 *
 * El listado guardaba sus filtros sólo en memoria, así que un enlace con
 * `?estado_compra=PEDIDO` abría la tabla entera sin filtrar. El tablero ya
 * enlazaba así desde el cartel de pedidos viejos: la promesa estaba hecha y no
 * se cumplía.
 *
 * Se leen una sola vez, al montar. La página no reescribe la URL a medida que
 * se tocan los desplegables: el query string es el punto de entrada, no un
 * espejo del estado.
 *
 * Cada filtro es una lista y no un valor: un solo estado por vez obligaba a
 * mirar «Cotizando» y «Para comprar» en dos pasadas, cuando lo que se quiere
 * saber es qué hay abierto. Dentro de un filtro los valores suman (o), y entre
 * filtros se recortan (y): «área Mantenimiento, estado Pedido o En camino».
 */
export interface FiltrosCompras {
  busqueda: string;
  area: string[];
  aprobacion: string[];
  compra: string[];
  prioridad: string[];
  empresa: string[];
  proveedor: string[];
  ubicacion: string[];
  /**
   * La máquina y el sector de planta salen del catálogo de ubicaciones, no del
   * requerimiento: el enlace vive ahí desde la 019. Son otra forma de recortar
   * lo mismo —"Doosan 300" es una ubicación y es un equipo—, y conviven porque
   * una máquina puede tener más de una ubicación y un sector, varias.
   */
  equipo: string[];
  sector: string[];
}

export const FILTROS_VACIOS: FiltrosCompras = {
  busqueda: "", area: [], aprobacion: [], compra: [],
  prioridad: [], empresa: [], proveedor: [], ubicacion: [],
  equipo: [], sector: [],
};

/** Las listas contra las que se validan los filtros que son referencias. */
export interface Catalogos {
  areas: string[];
  empresas: string[];
  proveedores: string[];
  ubicaciones: string[];
  /** Sólo los que tienen alguna ubicación enlazada: el resto daría vacío. */
  equipos: string[];
  sectores: string[];
}

/**
 * Los valores que trajo la URL para un filtro, ya validados.
 *
 * Se aceptan las dos formas: repetido (`?prioridad=ALTA&prioridad=URGENTE`),
 * que es lo que arma un formulario, y separado por comas
 * (`?prioridad=ALTA,URGENTE`), que es lo que se manda por chat sin que la URL
 * se vuelva ilegible. Ningún id ni ningún estado tiene comas, así que partir
 * por coma no rompe nada.
 *
 * Un valor que no está en la lista se descarta en silencio. Es preferible a
 * dejarlo puesto: un filtro que la persona no ve —porque el desplegable no
 * tiene esa opción— y no puede quitar deja una tabla vacía que se lee como "no
 * hay nada".
 */
function losQueEstanEnLaLista(
  params: URLSearchParams,
  nombre: string,
  permitidos: readonly string[]
): string[] {
  const vistos = new Set<string>();
  for (const crudo of params.getAll(nombre)) {
    for (const valor of crudo.split(",")) {
      const v = valor.trim();
      // Repetir un valor en la URL no tendría por qué duplicarlo en el `.in()`.
      if (v && permitidos.includes(v)) vistos.add(v);
    }
  }
  return [...vistos];
}

export function leerFiltrosDeLaUrl(
  params: URLSearchParams,
  catalogos: Catalogos
): FiltrosCompras {
  return {
    busqueda: params.get("q")?.trim() ?? "",
    area: losQueEstanEnLaLista(params, "area", catalogos.areas),
    aprobacion: losQueEstanEnLaLista(params, "estado_aprobacion", ESTADOS_APROBACION),
    compra: losQueEstanEnLaLista(params, "estado_compra", ESTADOS_COMPRA),
    prioridad: losQueEstanEnLaLista(params, "prioridad", PRIORIDADES),
    // "AMBAS" no es una empresa sino una condición —los RI que no tienen
    // ninguna, porque pagan las dos—, así que se acepta además de los ids.
    empresa: losQueEstanEnLaLista(params, "empresa", [...catalogos.empresas, "AMBAS"]),
    proveedor: losQueEstanEnLaLista(params, "proveedor", catalogos.proveedores),
    ubicacion: losQueEstanEnLaLista(params, "ubicacion", catalogos.ubicaciones),
    equipo: losQueEstanEnLaLista(params, "equipo", catalogos.equipos),
    sector: losQueEstanEnLaLista(params, "sector", catalogos.sectores),
  };
}

/** Si la URL trajo algo utilizable. Sirve para saber si arrancar filtrado. */
export function hayAlgunFiltro(f: FiltrosCompras): boolean {
  return Object.values(f).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
}
