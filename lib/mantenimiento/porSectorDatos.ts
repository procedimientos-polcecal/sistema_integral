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
 * iguales en el gráfico.
 *
 * **La ventana no acota casi nada, y conviene saberlo antes de confiar en
 * ella**: medido el 23/11/2026, el `.or` alcanza a 2.897 de las 2.902 filas de
 * la tabla —tres tandas de `traerTodo()`—, porque casi toda la historia de
 * `ordenes_trabajo` cabe en estos 455 días. Está escrita porque el día que la
 * tabla tenga años viejos sí va a acotar, no porque hoy ahorre viajes.
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
      // Las **dos** fechas, cada una por su lado y sin condicionar una a la
      // otra. La de falla sale de `fecha_ejecucion`, pero las barras de órdenes
      // por mes se cuentan por `fecha`, y hay filas donde las dos no caen en el
      // mismo año: medido el 23/11/2026, 4 de 2.901 —la #1223 dice
      // `fecha_ejecucion 2023-03-06` contra `fecha 2026-03-06`, el año mal
      // tipeado—. Con la condición vieja, `fecha_ejecucion.gte` ∨ (null ∧
      // `fecha.gte`), esas cuatro no se leían: la barra de Dic decía 96 contra
      // las 99 del gráfico de abajo, que lee la misma tabla por `fecha`. Traer
      // de más es correcto acá y traer de menos no, así que la rama por `fecha`
      // va suelta y de paso subsume a la que miraba el null.
      .or(`fecha_ejecucion.gte.${desde},fecha.gte.${desde}`)
      .order("ot_number")
      .range(de, a)
  );

  const sectores = await sectoresDePlanta<{
    id: string;
    nombre: string;
    codigo: string | null;
    empresas: unknown;
  }>(supabase, "id, nombre, codigo, empresas(nombre)");

  // `sectoresDePlanta` se come su error —`const { data } = …`— así que una
  // lectura fallida llega como lista vacía, y de ahí el `flatMap` de más abajo
  // se lleva **todas** las filas y la tabla dice «ningún sector tuvo
  // correctivas en el último año». Eso es exactamente la confusión que este
  // módulo evita en todo lo demás: un fallo de lectura indistinguible de un
  // «no hay nada». Acá no puede haber cero —son los quince sectores de planta
  // del catálogo, y si alguna vez fueran cero no habría nada que mostrar
  // igual—, así que vacío significa que la lectura no anduvo y se va por el
  // 500, que es lo que enciende el «Reintentar» de la pantalla.
  if (sectores.length === 0) {
    throw new Error("No se pudo leer el catálogo de sectores de planta");
  }

  // El embebido va **sin `!inner`**, como el historial completo y al revés que
  // el tablero: un cambio cuyo sector se borró tiene `sector_id` en null desde
  // la 20261119104730, y con `!inner` desaparecería de la cuenta.
  const filasDelLog = await traerTodo<Record<string, any>>((de, a) =>
    supabase
      .from("sectores_status_log")
      // Sin el `autor:changed_by(nombre, apellido)` que trae el historial: acá
      // no se muestra quién lo hizo —esta proyección sólo alimenta la cuenta de
      // paradas— y era un embebido a `usuarios`, una tabla cerrada con RLS, para
      // un campo que nunca llega a la pantalla.
      .select("id, sector_id, sector_nombre, old_status, new_status, reason, changed_at, " +
              "sector:sector_id(nombre)")
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
    // Siempre null: no se lee. `CambioDeSector` lo pide porque el historial
    // completo sí lo muestra, y ésta es la misma forma con un campo que acá no
    // se consulta — `paradasPorSector` no lo toca y no sale en la respuesta.
    autor: null,
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
