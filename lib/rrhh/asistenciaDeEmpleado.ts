import type { SupabaseClient } from "@supabase/supabase-js";
import { traerPaginado } from "./paginado";

/**
 * Los días de un empleado entre dos fechas: el cálculo de cada día con sus
 * marcaciones colgadas.
 *
 * Vive acá y no adentro de la ruta porque lo leen tres lugares —la pestaña
 * «Fichadas» de la ficha, el .xlsx y el PDF— y los tres tienen que ver
 * exactamente lo mismo. Un informe que difiere de la pantalla que lo generó no
 * sirve para discutir un sueldo.
 *
 * Pagina aunque sea un solo empleado: un año son ~365 cálculos y pueden ser
 * más de 1000 fichadas con el turno partido, y PostgREST corta en 1000 sin
 * avisar. El orden lleva `id` de desempate porque `.range()` es LIMIT/OFFSET:
 * con dos filas que ordenan igual, las páginas se solapan y una fichada sale
 * dos veces.
 */
export async function traerDiasDeAsistencia(
  supabase: SupabaseClient,
  empleadoId: string,
  desde: string,
  hasta: string
) {
  const [calculos, fichadas] = await Promise.all([
    traerPaginado(
      () =>
        supabase
          .from("calculos_diarios")
          .select("*")
          .eq("empleado_id", empleadoId)
          .gte("fecha", desde)
          .lte("fecha", hasta)
          .order("fecha", { ascending: true }),
      "calculos_diarios del empleado"
    ),
    traerPaginado(
      () =>
        supabase
          .from("fichadas")
          .select("id, fecha, hora_entrada, hora_salida")
          .eq("empleado_id", empleadoId)
          .gte("fecha", desde)
          .lte("fecha", hasta)
          .order("hora_entrada", { ascending: true })
          .order("id", { ascending: true }),
      "fichadas del empleado"
    ),
  ]);

  const porDia = new Map<string, typeof fichadas>();
  for (const f of fichadas) {
    const key = (f as { fecha: string }).fecha;
    if (!porDia.has(key)) porDia.set(key, []);
    porDia.get(key)!.push(f);
  }

  return calculos.map((c) => ({
    ...(c as Record<string, unknown>),
    fichadas: porDia.get((c as { fecha: string }).fecha) ?? [],
  }));
}
