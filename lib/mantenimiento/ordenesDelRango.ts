/**
 * Las órdenes que tocan un rango de días, tal como las necesita
 * `armarElCalendario`.
 *
 * Vive acá porque la piden dos: `/api/mantenimiento/calendario`, que alimenta
 * la grilla, y la hoja para imprimir, que se arma en el servidor y no puede
 * llamarse a sí misma por HTTP. Dos copias de esta consulta se separan sin que
 * nada avise —basta que una sume una columna— y el síntoma sería una hoja a la
 * que le faltan órdenes que la pantalla sí muestra, que es exactamente lo que
 * no se nota mirándola.
 *
 * **Se lee con el cliente de la sesión**, nunca con el admin: `ordenes_trabajo`
 * está cerrada con `mant_puede_ver()` y saltearla acá le mostraría la hoja
 * entera a quien la policy deja afuera.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import type { OrdenDelCalendario } from "./calendarioDeOT";

/** Una fecha de la base como `YYYY-MM-DD` pelado, igual que en las rutas hermanas. */
function soloElDia(v: unknown): string {
  return String(v ?? "").slice(0, 10);
}

/**
 * Las órdenes que pueden tocar `[desde, hasta]`.
 *
 * Los dos `.or()` se combinan con AND y dan un **superconjunto** de lo que
 * cruza el rango: empieza antes del final Y (termina, o empieza, después del
 * principio). La fecha de inicio es la pendiente si la hay y si no la de la
 * planilla, y eso no se puede decir en un filtro de PostgREST sin un
 * `coalesce`, así que se miran las dos. Sobran filas y `armarElCalendario` las
 * descarta con la cuenta exacta; no falta ninguna. Una OT sin ninguna fecha no
 * entra por la primera condición.
 *
 * `traerTodo` y no un `.select()` pelado: PostgREST corta en 1000 filas sin
 * avisar.
 */
export async function ordenesDelRango(
  supabase: SupabaseClient,
  desde: string,
  hasta: string,
): Promise<OrdenDelCalendario[]> {
  const filas = await traerTodo<OrdenDelCalendario>((d, h) =>
    supabase
      .from("ordenes_trabajo")
      // `id`, `app_created` y `estado` entran para que la grilla pueda decidir
      // sola si una orden se puede mover (`porQueNoSePuedeMover`) y llamar a
      // `postergar` sin otro viaje. No son dato sensible: quien llega acá ya
      // ve las órdenes enteras en el listado.
      .select(
        "id, ot_number, fecha_ejecucion, fecha_ejecucion_pendiente, fecha_fin, especialidad, tipo, quien, descripcion, sector_raw, equipo_raw, app_created, estado, operario_1, operario_2, operario_3"
      )
      .or(`fecha_ejecucion.lte.${hasta},fecha_ejecucion_pendiente.lte.${hasta}`)
      .or(
        `fecha_fin.gte.${desde},fecha_ejecucion.gte.${desde},fecha_ejecucion_pendiente.gte.${desde}`
      )
      .order("ot_number")
      .range(d, h)
  );

  return filas.map((f) => ({
    ...f,
    fecha_ejecucion: f.fecha_ejecucion ? soloElDia(f.fecha_ejecucion) : null,
    fecha_ejecucion_pendiente: f.fecha_ejecucion_pendiente
      ? soloElDia(f.fecha_ejecucion_pendiente)
      : null,
    fecha_fin: f.fecha_fin ? soloElDia(f.fecha_fin) : null,
  }));
}
