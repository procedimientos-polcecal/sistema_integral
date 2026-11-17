import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { sumarDias } from "@/lib/core/fechas";
import { calcularMtbf, VENTANA_DIAS, type Mtbf, type OtCruda } from "./mtbf";
import { calcularMttr, type Mttr, type OtReparacion } from "./mttr";

/**
 * Las columnas que necesitan los dos indicadores juntos.
 *
 * `OtCruda` es lo que pide el MTBF y `OtReparacion` lo que pide el MTTR; las
 * dos describen la misma fila y se piden en una sola lectura. Leerlas dos
 * veces para calcular dos promedios sobre **las mismas 980 correctivas** sería
 * pagar dos veces el paginado de una tabla de 2.400 filas.
 */
type OtDeLosIndicadores = OtCruda & OtReparacion;

/**
 * Lee las correctivas de la ventana **una sola vez** y devuelve las dos
 * cuentas ya hechas: cada cuánto falla cada equipo y cuánto tarda en volver.
 *
 * `ordenes_trabajo` tiene más de 2.000 filas y PostgREST corta en 1000 sin
 * avisar: sin `traerTodo()` la cuenta perdería la mitad de las fallas y no daría
 * error, daría MTBF optimistas.
 *
 * El filtro de fecha de la consulta es una **optimización, no la regla**:
 * `calcularMtbf` vuelve a filtrar. Se pide un día de más (`desde` es hasta - 365,
 * y la ventana empieza en hasta - 364) y, como una OT sin `fecha_ejecucion` entra
 * por `fecha`, el filtro cubre las dos. Traer de más es correcto; traer de menos
 * no lo es.
 *
 * Se ordena por `ot_number` porque paginar sin un orden estable puede repetir o
 * saltearse filas entre una tanda y la siguiente.
 */
export async function indicadoresDeLaPlanta(
  supabase: SupabaseClient,
  hasta: string
): Promise<{ mtbf: Mtbf; mttr: Mttr }> {
  const desde = sumarDias(hasta, -VENTANA_DIAS);

  // La cadena va literal: armarla en una variable le hace perder la
  // inferencia de tipos a Supabase. Es regla de la casa.
  const ordenes = await traerTodo<OtDeLosIndicadores>((de, a) =>
    supabase
      .from("ordenes_trabajo")
      .select("ot_number, tipo, fecha, fecha_ejecucion, equipment_id, equipo_raw, especialidad, horas, contratista")
      .eq("tipo", "CORRECTIVO")
      .or(
        `fecha_ejecucion.gte.${desde},and(fecha_ejecucion.is.null,fecha.gte.${desde})`
      )
      .order("ot_number")
      .range(de, a)
  );

  return { mtbf: calcularMtbf(ordenes, hasta), mttr: calcularMttr(ordenes, hasta) };
}

/**
 * Sólo el MTBF, para quien no necesita el otro.
 *
 * Sigue existiendo —y lee lo mismo— porque la ruta `/api/mantenimiento/mtbf`
 * devuelve este objeto tal cual y el tablero lo consume por ahí: cambiarle la
 * forma a esa respuesta es romper al cliente que ya la lee.
 */
export async function mtbfDeLaPlanta(
  supabase: SupabaseClient,
  hasta: string
): Promise<Mtbf> {
  return (await indicadoresDeLaPlanta(supabase, hasta)).mtbf;
}
