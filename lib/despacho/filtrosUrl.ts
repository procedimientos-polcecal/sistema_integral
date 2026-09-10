import { fechaDeTexto } from "@/lib/core/fechas";
import { escribirEnLaUrl, hayAlgunFiltro as hayAlguno, losQueEstanEnLaLista } from "@/lib/core/filtrosUrl";
import { ENVASES, MATERIALES } from "@/lib/core/productos";

/**
 * Los filtros del histórico de órdenes, leídos y escritos en la URL.
 *
 * Mismo motivo que en Inventario, Compras y Mantenimiento: en memoria se pierden
 * al entrar a una orden y volver, y un enlace a "todo lo que salió a granel en
 * agosto" no se puede mandar por chat — que es como se pasa la mitad de estas
 * preguntas.
 *
 * `material` y `envase` **no son columnas de la orden**: viven en el mapeo de
 * productos. Se leen igual acá porque para quien filtra son un filtro más; el
 * cruce lo hace la página contra `despacho_productos`.
 */

export interface FiltrosDeHistorico {
  cliente: string;
  material: string;
  envase: string;
  empresa: string;
  desde: string;
  hasta: string;
}

export const HISTORICO_SIN_FILTROS: FiltrosDeHistorico = {
  cliente: "",
  material: "",
  envase: "",
  empresa: "",
  desde: "",
  hasta: "",
};

/**
 * Un valor que no está en la lista se descarta en vez de filtrar por él.
 *
 * `?material=Titanio` con el valor pasado tal cual a la consulta devolvería
 * cero filas y parecería que no hay órdenes. Descartado, se ve el listado sin
 * ese filtro, que es lo que espera cualquiera que pegó una URL vieja.
 */
function elQueEstaEnLaLista(
  params: URLSearchParams,
  nombre: string,
  lista: readonly string[]
): string {
  return losQueEstanEnLaLista(params, nombre, lista)[0] ?? "";
}

export function leerFiltrosDelHistorico(
  params: URLSearchParams,
  empresas: readonly string[]
): FiltrosDeHistorico {
  return {
    cliente: params.get("cliente")?.trim() ?? "",
    material: elQueEstaEnLaLista(params, "material", MATERIALES),
    envase: elQueEstaEnLaLista(params, "envase", ENVASES),
    empresa: elQueEstaEnLaLista(params, "empresa", empresas),
    desde: fechaDeTexto(params.get("desde")) ?? "",
    hasta: fechaDeTexto(params.get("hasta")) ?? "",
  };
}

/** El orden en que van los filtros en la URL, y con qué nombre. */
const NOMBRES: readonly [keyof FiltrosDeHistorico, string][] = [
  ["cliente", "cliente"],
  ["material", "material"],
  ["envase", "envase"],
  ["empresa", "empresa"],
  ["desde", "desde"],
  ["hasta", "hasta"],
];

export const escribirFiltrosDelHistorico = (f: FiltrosDeHistorico): string =>
  escribirEnLaUrl(f, NOMBRES);

/** Si hay algo puesto. Sirve para saber si la tabla vacía es por los filtros. */
export const hayFiltrosDelHistorico = (f: FiltrosDeHistorico): boolean => hayAlguno(f);
