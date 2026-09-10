import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Producción.
 *
 *   lectura  ve los partes y los resúmenes
 *   edicion  además carga y corrige partes
 *   admin    además da de alta y edita renglonesDePapel del catálogo
 *
 * En la base los espejan `tiene_acceso_produccion()`,
 * `puede_editar_produccion()` y `es_admin_produccion()`. Las dos mitades tienen
 * que decir lo mismo: es lo que la 029 tuvo que corregir en Mantenimiento cuando
 * un `admin_sistema` veía los botones y RLS le devolvía listas vacías.
 */

export async function nivelProduccionDe(
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

  return nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "produccion");
}

/** Acceso al módulo, con cualquier nivel. Hace falta donde se usa el cliente admin: ahí RLS no corre. */
export async function tieneAccesoProduccion(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelProduccionDe(supabase, userId)) !== null;
}

/** Cargar y corregir partes. */
export async function puedeEditarProduccion(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const nivel = await nivelProduccionDe(supabase, userId);
  return nivel === "edicion" || nivel === "admin";
}

/** Dar de alta y editar renglonesDePapel del catálogo. */
export async function esAdminProduccion(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelProduccionDe(supabase, userId)) === "admin";
}
