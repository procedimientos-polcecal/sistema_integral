import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { sumarDias } from "@/lib/core/fechas";
import { VENTANA_DIAS, DIAS_RECIENTE } from "./mtbf";
import {
  indicadoresPorSector, type FilaDeSector, type OrdenesDelMes, type OtDeSector,
} from "./porSector";
import { paradasPorSector, type ParadaDeSector } from "./paradasDeSector";
import { sectoresDePlanta, empresaDelSector } from "./sectores";
import type { CambioDeSector } from "./historialDeSectores";

/**
 * De dónde salen los indicadores por sector del tablero.
 *
 * Calcado de `mtbfDatos.ts`, con dos diferencias que valen la pena:
 *
 * **Se leen `VENTANA_DIAS + DIAS_RECIENTE` días y no los 365.** Los 90 de más
 * son los que necesita el primer punto de la serie mensual, que mira hacia
 * atrás: pidiendo sólo el año, ese punto quedaría en `null` por falta de
 * lectura y no por falta de fallas, que son dos cosas distintas y se ven
 * iguales en el gráfico. Medido el 19/11/2026 son **2.503 órdenes**, una tanda
 * y media de `traerTodo()`.
 *
 * **Se traen todos los tipos, no sólo las correctivas.** El gráfico de órdenes
 * por mes y por sector no es de fallas; el filtro de `CORRECTIVO` lo aplica
 * `indicadoresPorSector` adentro, igual que `calcularMtbf`.
 *
 * `ordenes_trabajo` tiene más de 2.500 filas y PostgREST corta en 1000 sin
 * avisar: sin `traerTodo()` la cuenta perdería más de la mitad de las fallas y
 * no daría error, daría MTBF optimistas.
 *
 * El filtro de fecha de la consulta es una **optimización, no la regla**: la
 * función pura vuelve a filtrar. Se pide un día de más y, como una OT sin
 * `fecha_ejecucion` entra por `fecha`, el filtro cubre las dos. Traer de más
 * es correcto; traer de menos no lo es.
 *
 * Se ordena por `ot_number` porque paginar sin un orden estable puede repetir
 * o saltearse filas entre una tanda y la siguiente.
 */

/** Una fila con lo que hace falta para filtrarla y nombrarla en pantalla. */
export interface SectorConNombre extends FilaDeSector {
  sector: string;
  /** El nombre de la empresa, o «TRANSVERSAL» para los que sirven a las dos. */
  empresa: string;
}

export interface IndicadoresDeLaPlantaPorSector {
  filas: SectorConNombre[];
  ordenesPorMes: OrdenesDelMes[];
  /** Todos los de planta, también los que no tuvieron ninguna falla. */
  sectores: { id: string; nombre: string; empresa: string }[];
  paradas: { sectores: ParadaDeSector[]; desde: string | null };
  mesEnCurso: string;
  sinSector: number;
  hasta: string;
}

export async function indicadoresPorSectorDeLaPlanta(
  supabase: SupabaseClient,
  hasta: string
): Promise<IndicadoresDeLaPlantaPorSector> {
  const desde = sumarDias(hasta, -(VENTANA_DIAS + DIAS_RECIENTE));

  // La cadena va literal: armarla en una variable le hace perder la
  // inferencia de tipos a Supabase. Es regla de la casa.
  const ordenes = await traerTodo<OtDeSector>((de, a) =>
    supabase
      .from("ordenes_trabajo")
      .select("ot_number, tipo, fecha, fecha_ejecucion, sector_id, horas, contratista")
      .or(`fecha_ejecucion.gte.${desde},and(fecha_ejecucion.is.null,fecha.gte.${desde})`)
      .order("ot_number")
      .range(de, a)
  );

  const sectores = await sectoresDePlanta<{
    id: string;
    nombre: string;
    codigo: string | null;
    empresas: unknown;
  }>(supabase, "id, nombre, codigo, empresas(nombre)");

  // El embebido va **sin `!inner`**, como el historial completo y al revés que
  // el tablero: un cambio cuyo sector se borró tiene `sector_id` en null desde
  // la 20261119104730, y con `!inner` desaparecería de la cuenta.
  const filasDelLog = await traerTodo<Record<string, any>>((de, a) =>
    supabase
      .from("sectores_status_log")
      .select("id, sector_id, sector_nombre, old_status, new_status, reason, changed_at, " +
              "sector:sector_id(nombre), autor:changed_by(nombre, apellido)")
      .order("changed_at", { ascending: false })
      .range(de, a)
  );

  const cambios: CambioDeSector[] = filasDelLog.map((f) => ({
    id: f.id,
    sector_id: f.sector_id ?? null,
    // El nombre de hoy primero y el guardado como respaldo, igual que en
    // `/mantenimiento/sectores/historial`: si el sector sigue vivo y lo
    // renombraron, hay que decir cómo se llama ahora.
    sector: f.sector?.nombre ?? f.sector_nombre ?? null,
    old_status: f.old_status ?? null,
    new_status: f.new_status,
    reason: f.reason ?? null,
    changed_at: f.changed_at,
    autor: f.autor
      ? `${f.autor.nombre ?? ""} ${f.autor.apellido ?? ""}`.trim() || null
      : null,
  }));

  const indicadores = indicadoresPorSector(ordenes, hasta);

  const nombres = new Map(
    sectores.map((s) => [
      s.id,
      { nombre: s.nombre, empresa: empresaDelSector(s.empresas) ?? "TRANSVERSAL" },
    ])
  );

  return {
    // Un sector que ya no está en el catálogo de planta queda afuera: sin
    // nombre ni empresa no se lo puede ni nombrar ni filtrar. Es la misma
    // regla que el listado de MTBF aplica a los equipos dados de baja.
    filas: indicadores.filas.flatMap((f) => {
      const suyo = nombres.get(f.sectorId);
      return suyo ? [{ ...f, sector: suyo.nombre, empresa: suyo.empresa }] : [];
    }),
    ordenesPorMes: indicadores.ordenesPorMes,
    sectores: sectores.map((s) => ({
      id: s.id,
      nombre: s.nombre,
      empresa: empresaDelSector(s.empresas) ?? "TRANSVERSAL",
    })),
    // «Ahora» se resuelve una sola vez y acá: de él sale la duración de todo
    // estado todavía abierto, y que cada fila lo calcule contra su propio
    // reloj daría números que no cierran entre sí.
    paradas: paradasPorSector(cambios, new Date().toISOString()),
    mesEnCurso: indicadores.mesEnCurso,
    sinSector: indicadores.sinSector,
    hasta,
  };
}
