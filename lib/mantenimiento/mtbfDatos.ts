import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { sumarDias } from "@/lib/core/fechas";
import { calcularMtbf, VENTANA_DIAS, type Mtbf, type OtCruda } from "./mtbf";

/**
 * Lee las correctivas de la ventana y devuelve la cuenta ya hecha.
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
export async function mtbfDeLaPlanta(
  supabase: SupabaseClient,
  hasta: string
): Promise<Mtbf> {
  const desde = sumarDias(hasta, -VENTANA_DIAS);

  const ordenes = await traerTodo<OtCruda>((de, a) =>
    supabase
      .from("ordenes_trabajo")
      .select("ot_number, tipo, fecha, fecha_ejecucion, equipment_id, equipo_raw, especialidad")
      .eq("tipo", "CORRECTIVO")
      .or(
        `fecha_ejecucion.gte.${desde},and(fecha_ejecucion.is.null,fecha.gte.${desde})`
      )
      .order("ot_number")
      .range(de, a)
  );

  return calcularMtbf(ordenes, hasta);
}
