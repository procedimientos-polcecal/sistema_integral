import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Calidad.
 *
 *   lectura  ve el stock y el libro
 *   edicion  además carga consumos, conteos, ajustes y entradas a mano
 *   admin    además edita los carbonilleros y la lista blanca de productos
 *
 * En la base los espejan `tiene_acceso_calidad()`, `puede_editar_calidad()` y
 * `es_admin_calidad()`. Las dos mitades tienen que decir lo mismo: es lo que la
 * 029 tuvo que corregir en Mantenimiento cuando un `admin_sistema` veía los
 * botones y RLS le devolvía listas vacías.
 */

export async function nivelCalidadDe(
  supabase: SupabaseClient,
  userId: string
): Promise<UsuarioModulo["nivel"] | null> {
  const { data: usuario } = await supabase
    .from("usuarios")
    .select("rol")
    .eq("id", userId)
    .single();
  if (!usuario) return null;

  const { data: grants } = await supabase
    .from("usuario_modulos")
    .select("id, usuario_id, modulo, nivel")
    .eq("usuario_id", userId);

  return nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "calidad");
}

/** Acceso al módulo, con cualquier nivel. Hace falta donde se usa el cliente admin: ahí RLS no corre. */
export async function tieneAccesoCalidad(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelCalidadDe(supabase, userId)) !== null;
}

/** Cargar consumos, conteos, ajustes y entradas a mano. */
export async function puedeEditarCalidad(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const nivel = await nivelCalidadDe(supabase, userId);
  return nivel === "edicion" || nivel === "admin";
}

/** Editar los carbonilleros y la lista blanca de productos. */
export async function esAdminCalidad(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelCalidadDe(supabase, userId)) === "admin";
}
