import { escribirEnLaUrl, losQueEstanEnLaLista } from "@/lib/core/filtrosUrl";
import type { FiltrosDeGestion } from "./gestion";

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
