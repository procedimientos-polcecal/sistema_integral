import { escribirEnLaUrl, losQueEstanEnLaLista } from "@/lib/core/filtrosUrl";
import type { FiltrosDeGestion } from "./gestion";
import {
  COLUMNAS_ORDENABLES,
  ORDEN_POR_DEFECTO,
  SIN_COLUMNA,
  type OrdenDeColumna,
} from "./ordenDeColumna";

/**
 * Los filtros de la gestión de condiciones, leídos y escritos en la URL.
 *
 * Mismo motivo que en Despacho, Inventario y Mantenimiento: **el enlace es la
 * mitad del aviso**. El resumen diario llega al teléfono diciendo «3 más ·
 * Condiciones inseguras vencidas» y quien lo toca tiene que aterrizar en esas
 * tres, no en la lista entera buscándolas a mano. Los dos avisos de
 * `lib/home/avisos.ts` apuntan acá, y `filtrosUrl.test.ts` ata cada href a lo
 * que esta función lee: si cambia el vocabulario, rompe ahí y no en un teléfono.
 *
 * El vocabulario es el de `FiltrosDeGestion`, que es el de los desplegables y
 * los botones del encabezado: `Vencida`, no `vencida`; `alguna`, no
 * `cualquiera`. Lo que no está en la lista se descarta en vez de filtrar por
 * ello, y se ve la lista sin ese filtro.
 */

const ESTADOS = ["Pendiente", "Cerrada", "Vencida", "abierta"] as const;
const FALTAS = ["sin_evaluar", "sin_asignar", "sin_lugar", "alguna"] as const;
const CLASIFICACIONES = ["I", "S", "M", "PS", "NS", "sin_clasificar"] as const;

export interface LugaresConocidos {
  sectores: readonly string[];
  equipos: readonly string[];
}

export function leerFiltrosDeGestion(
  params: URLSearchParams,
  lugares: LugaresConocidos
): FiltrosDeGestion {
  const uno = (nombre: string, lista: readonly string[]) =>
    losQueEstanEnLaLista(params, nombre, lista)[0] ?? "";

  // El lugar es `s:<id>` o `e:<id>`: se valida el prefijo contra el catálogo
  // que corresponde, no sólo que el id exista en algún lado.
  const permitidosDeLugar = [
    ...lugares.sectores.map((id) => `s:${id}`),
    ...lugares.equipos.map((id) => `e:${id}`),
  ];

  return {
    estado: uno("estado", ESTADOS) as FiltrosDeGestion["estado"],
    falta: uno("falta", FALTAS) as FiltrosDeGestion["falta"],
    lugar: uno("lugar", permitidosDeLugar),
    clasificacion: uno("clasificacion", CLASIFICACIONES) as FiltrosDeGestion["clasificacion"],
  };
}

const NOMBRES: readonly [keyof FiltrosDeGestion, string][] = [
  ["estado", "estado"],
  ["falta", "falta"],
  ["lugar", "lugar"],
  ["clasificacion", "clasificacion"],
];

export const escribirFiltrosDeGestion = (f: FiltrosDeGestion): string =>
  escribirEnLaUrl(f, NOMBRES);

/**
 * El orden elegido también viaja en la URL, por el mismo motivo que los
 * filtros: una tabla ordenada por fecha máxima es algo que alguien manda por
 * chat, y recargar no tiene por qué deshacerlo.
 *
 * Va en dos parámetros y no en uno (`orden=riesgo&dir=desc`) para que cada uno
 * se valide contra su propia lista: un `dir` raro cae en ascendente y no se
 * lleva puesta la columna.
 *
 * **Sin `orden` en la URL, el orden es el de la pantalla** —el que sube lo
 * vencido y lo incompleto—, que es el anti-objetivo del módulo y por eso es lo
 * que vale cuando nadie pidió otra cosa.
 */
export function leerOrdenDeGestion(params: URLSearchParams): OrdenDeColumna {
  const columna = losQueEstanEnLaLista(params, "orden", COLUMNAS_ORDENABLES)[0];
  if (!columna) return ORDEN_POR_DEFECTO;
  const dir = losQueEstanEnLaLista(params, "dir", ["asc", "desc"])[0];
  return { columna: columna as OrdenDeColumna["columna"], ascendente: dir !== "desc" };
}

/** Vacío cuando es el orden por defecto: la URL limpia es la de siempre. */
export function escribirOrdenDeGestion(o: OrdenDeColumna): string {
  if (o.columna === SIN_COLUMNA) return "";
  return escribirEnLaUrl(
    { orden: o.columna, dir: o.ascendente ? "asc" : "desc" },
    [["orden", "orden"], ["dir", "dir"]]
  );
}
