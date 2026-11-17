import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { estadoDeLaCarga } from "./cuadernoGrupos";

/**
 * Recalcula `mant_cuadernos.estado` desde los renglones y lo escribe.
 *
 * **Vive acá porque lo mueven dos cosas distintas**: generar una orden —un
 * renglón pasa a tenerla— y **sacar** un renglón —deja de haber un pendiente—.
 * Con una copia en cada ruta, el día que la regla cambie una de las dos la
 * sigue diciendo vieja, y una columna de estado que miente es exactamente la
 * que el próximo lector va a creer.
 *
 * Se lee de la base en vez de deducirlo de lo que la ruta acaba de hacer,
 * porque lo que importa es lo que quedó.
 *
 * Devuelve **el motivo crudo** si no pudo, o null si quedó escrito. No lo
 * redacta: cada ruta lo mete en su propia frase, porque «las órdenes se
 * generaron, pero…» no es lo mismo que «el renglón se sacó, pero…».
 */
export async function actualizarElEstado(
  db: SupabaseClient,
  cuadernoId: string
): Promise<string | null> {
  try {
    const filas = await traerTodo<{ orden_trabajo_id: string | null }>((d, h) =>
      db
        .from("mant_cuadernos_renglones")
        .select("orden_trabajo_id")
        .eq("cuaderno_id", cuadernoId)
        .order("id")
        .range(d, h)
    );
    const { error } = await db
      .from("mant_cuadernos")
      .update({ estado: estadoDeLaCarga(filas) })
      .eq("id", cuadernoId);
    return error ? error.message : null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
