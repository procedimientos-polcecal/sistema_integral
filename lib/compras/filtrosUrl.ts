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
 */
export interface FiltrosCompras {
  busqueda: string;
  area: string;
  aprobacion: string;
  compra: string;
  prioridad: string;
  empresa: string;
  proveedor: string;
  ubicacion: string;
}

export const FILTROS_VACIOS: FiltrosCompras = {
  busqueda: "", area: "", aprobacion: "", compra: "",
  prioridad: "", empresa: "", proveedor: "", ubicacion: "",
};

/** Las listas contra las que se validan los filtros que son referencias. */
export interface Catalogos {
  areas: string[];
  empresas: string[];
  proveedores: string[];
  ubicaciones: string[];
}

/**
 * Un valor que no está en la lista se descarta en silencio.
 *
 * Es preferible a dejarlo puesto: un filtro que la persona no ve —porque el
 * desplegable no tiene esa opción— y no puede quitar deja una tabla vacía que
 * se lee como "no hay nada".
 */
function siEstaEnLaLista(valor: string | null, permitidos: readonly string[]): string {
  return valor && permitidos.includes(valor) ? valor : "";
}

export function leerFiltrosDeLaUrl(
  params: URLSearchParams,
  catalogos: Catalogos
): FiltrosCompras {
  return {
    busqueda: params.get("q")?.trim() ?? "",
    area: siEstaEnLaLista(params.get("area"), catalogos.areas),
    aprobacion: siEstaEnLaLista(params.get("estado_aprobacion"), ESTADOS_APROBACION),
    compra: siEstaEnLaLista(params.get("estado_compra"), ESTADOS_COMPRA),
    prioridad: siEstaEnLaLista(params.get("prioridad"), PRIORIDADES),
    // "AMBAS" no es una empresa sino una condición —los RI que no tienen
    // ninguna, porque pagan las dos—, así que se acepta además de los ids.
    empresa: siEstaEnLaLista(params.get("empresa"), [...catalogos.empresas, "AMBAS"]),
    proveedor: siEstaEnLaLista(params.get("proveedor"), catalogos.proveedores),
    ubicacion: siEstaEnLaLista(params.get("ubicacion"), catalogos.ubicaciones),
  };
}

/** Si la URL trajo algo utilizable. Sirve para saber si arrancar filtrado. */
export function hayAlgunFiltro(f: FiltrosCompras): boolean {
  return Object.values(f).some(Boolean);
}
