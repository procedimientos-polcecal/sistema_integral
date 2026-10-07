import type { SupabaseClient } from "@supabase/supabase-js";

export interface DiaDeEmpleado {
  empleadoId: string;
  fecha: string; // "YYYY-MM-DD"
}

/** Lo de una fichada que cuenta para decidir si alguien la corrigió. */
export interface FichadaGuardada extends DiaDeEmpleado {
  horaEntrada: string; // timestamptz, como lo devuelve PostgREST
  horaSalida: string | null;
  observaciones: string | null;
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
 * puede hacer fallar la edición que sí funcionó. Pero tampoco calla: devuelve
 * si pudo, y la ruta se lo pasa a la persona (`diaSinProteger`), además de
 * dejarlo en el log. El fallo probable no es transitorio —migración sin
 * correr, una policy mal armada, un `usuario_id` inválido—: falla SIEMPRE, y
 * entonces cada corrección queda desprotegida y el cron la pisa a la mañana
 * siguiente. Un log de Vercel que nadie mira no alcanza para decirlo.
 */
export async function marcarDiaCorregido(
  supabase: SupabaseClient,
  empleadoId: string,
  fecha: string, // "YYYY-MM-DD", tal cual lo devuelve PostgREST para una columna `date`
  usuarioId: string,
  accion: "creada" | "editada" | "borrada"
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("rrhh_dias_corregidos")
      .upsert(
        { empleado_id: empleadoId, fecha, usuario_id: usuarioId, accion },
        { onConflict: "empleado_id,fecha" }
      );
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    console.error("No se pudo marcar el día como corregido:", empleadoId, fecha, e);
    return false;
  }
}

// null, undefined y "" son lo mismo: la ruta guarda `observaciones || null`, y
// una fila vieja puede traer "". Comparar sin normalizar daría "cambió" por una
// diferencia que no lo es, y eso congela el día.
function textoONulo(t: string | null | undefined): string | null {
  return t ? t : null;
}

// Dos timestamptz son el mismo instante aunque se escriban distinto
// ("+00:00" contra "Z"); si alguno no se puede leer, se compara el texto.
function mismoInstante(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isNaN(ta) || Number.isNaN(tb) ? a === b : ta === tb;
}

/**
 * Qué días hay que marcar cuando se edita una fichada.
 *
 * **Si no cambió nada, ninguno.** `FichadaEditModal.guardar` manda un PUT por
 * cada fila existente, haya cambiado o no: quien abre un día para ajustar las
 * horas manuales y toca Guardar pasa por acá con todas sus fichadas intactas.
 * Marcarlas congelaría el día para siempre —la sincronización lo saltea— sin
 * que nadie haya corregido nada. Por eso se compara lo que había contra lo que
 * quedó, y no se confía en lo que mandó el cliente.
 *
 * Si cambió algo, siempre el día en que quedó. Y si además la movió de día o de
 * empleado, también el de donde salió: ahí quedó un hueco que una persona
 * decidió, y si sólo se marcara el destino, el cron reinsertaría mañana la
 * marca que se llevaron — el mismo día duplicado que esta tabla existe para
 * evitar.
 *
 * Sin lectura previa no hay con qué comparar, y se marca: ante la duda, el día
 * queda protegido; el costo de equivocarse para ese lado es un día que no se
 * sincroniza, y para el otro, una corrección que se pierde.
 */
export function diasAMarcarAlEditar(
  previa: FichadaGuardada | null,
  posterior: FichadaGuardada
): DiaDeEmpleado[] {
  const destino = { empleadoId: posterior.empleadoId, fecha: posterior.fecha };
  if (!previa) return [destino];

  const seMovio = previa.empleadoId !== posterior.empleadoId || previa.fecha !== posterior.fecha;
  const cambio =
    seMovio ||
    !mismoInstante(previa.horaEntrada, posterior.horaEntrada) ||
    !mismoInstante(previa.horaSalida, posterior.horaSalida) ||
    textoONulo(previa.observaciones) !== textoONulo(posterior.observaciones);
  if (!cambio) return [];

  return seMovio ? [destino, { empleadoId: previa.empleadoId, fecha: previa.fecha }] : [destino];
}
