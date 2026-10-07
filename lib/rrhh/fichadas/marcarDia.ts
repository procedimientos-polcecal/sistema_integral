import type { SupabaseClient } from "@supabase/supabase-js";

export interface DiaDeEmpleado {
  empleadoId: string;
  fecha: string; // "YYYY-MM-DD"
}

/**
 * Deja anotado que una persona tocó este (empleado, día), para que la
 * sincronización con Lenox no se lo pise mañana.
 *
 * Lo llaman los tres verbos que significan eso: el alta manual, la edición y
 * el borrado. El borrado es el que obliga a que esto exista como tabla aparte
 * y no como un valor de `origen`: cuando alguien borra una fichada importada
 * —una marca fantasma a 40 minutos de la anterior, que el filtro de 5 minutos
 * no agarró y que arma un turno falso—, la fila que probaría que alguien la
 * tocó ya no está, y el cron la volvería a crear todos los días.
 *
 * `upsert` y no `insert`: tocar el mismo día dos veces es lo normal.
 *
 * No lanza. Es una protección, no la operación: que no se pueda anotar no
 * puede hacer fallar la edición que sí funcionó. Lo que sí hace es dejarlo en
 * el log, porque un día sin anotar es un día que el cron va a pisar.
 */
export async function marcarDiaCorregido(
  supabase: SupabaseClient,
  empleadoId: string,
  fecha: string, // "YYYY-MM-DD", tal cual lo devuelve PostgREST para una columna `date`
  usuarioId: string,
  accion: "creada" | "editada" | "borrada"
): Promise<void> {
  try {
    const { error } = await supabase
      .from("rrhh_dias_corregidos")
      .upsert(
        { empleado_id: empleadoId, fecha, usuario_id: usuarioId, accion },
        { onConflict: "empleado_id,fecha" }
      );
    if (error) throw new Error(error.message);
  } catch (e) {
    console.error("No se pudo marcar el día como corregido:", empleadoId, fecha, e);
  }
}

/**
 * Qué días hay que marcar cuando se edita una fichada.
 *
 * Siempre el día en que quedó. Y si la edición la movió de día o de empleado,
 * también el de donde salió: ahí quedó un hueco que una persona decidió, y si
 * sólo se marcara el destino, el cron reinsertaría mañana la marca que se
 * llevaron — el mismo día duplicado que esta tabla existe para evitar.
 *
 * Se compara lo que había contra lo que quedó, y no si el cuerpo trajo `fecha`
 * o `employeeId`: el modal los manda siempre, se hayan movido o no.
 */
export function diasAMarcarAlEditar(
  previa: DiaDeEmpleado | null,
  posterior: DiaDeEmpleado
): DiaDeEmpleado[] {
  if (!previa) return [posterior];
  const seMovio = previa.empleadoId !== posterior.empleadoId || previa.fecha !== posterior.fecha;
  return seMovio ? [posterior, previa] : [posterior];
}
