import type { SupabaseClient } from "@supabase/supabase-js";
import { duenoDelEventoDeLaOT } from "./evento";

/**
 * De quién va a ser el evento de una OT **que todavía no tiene evento**: la
 * casilla que generó la orden, o `mantenimiento@` si nadie la cargó en el
 * sistema.
 *
 * La decisión es `duenoDelEventoDeLaOT` (con sus números medidos); esto es sólo
 * la lectura del generador que esa función necesita. Vive acá porque la
 * necesitan **dos** rutas —el POST, que crea el evento, y el GET, con el que el
 * modal le dice a la persona de quién va a ser antes de apretar— y si cada una
 * armaba su lectura, el modal podía prometer un dueño y el POST escribir otro.
 *
 * No busca al usuario de la casilla del área ni comprueba que esté activo: eso
 * lo necesita sólo quien va a escribir (`dueno_id` pide un usuario), y el POST
 * lo hace a continuación.
 */
export async function elegirElDuenoDeLaOT(
  admin: SupabaseClient,
  createdBy: string | null
): Promise<
  | { ok: true; id: string | null; casilla: string; delArea: boolean }
  | { ok: false; error: string }
> {
  let generador: { id: string; email: string | null } | null = null;
  if (createdBy) {
    const { data, error } = await admin
      .from("usuarios")
      .select("id, email")
      .eq("id", createdBy)
      .maybeSingle();
    if (error) return { ok: false, error: `No se pudo averiguar quién generó la orden: ${error.message}` };
    generador = (data as { id: string; email: string | null } | null) ?? null;
  }
  return { ok: true, ...duenoDelEventoDeLaOT(generador) };
}
