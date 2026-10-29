import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Seguridad e Higiene.
 *
 *   lectura  ve la tabla de condiciones y sus fotos
 *   edicion  además carga una condición y corrige su primera etapa (lugar,
 *            descripción, peligro, acción, prioridad) mientras no esté cerrada
 *   admin    además evalúa el riesgo, asigna, cierra, reabre y corrige lo ya
 *            evaluado
 *
 * En la base los espejan `tiene_acceso_syh()`, `puede_editar_syh()` y
 * `es_admin_syh()`. Las dos mitades tienen que decir lo mismo: es lo que la
 * 029 tuvo que corregir en Mantenimiento cuando un `admin_sistema` veía los
 * botones y RLS le devolvía listas vacías.
 */

export async function nivelSyhDe(
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

  return nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "seguridad_higiene");
}

/** Acceso al módulo, con cualquier nivel. Hace falta donde se usa el cliente admin: ahí RLS no corre. */
export async function tieneAccesoSyh(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelSyhDe(supabase, userId)) !== null;
}

/** Cargar una condición y corregir su primera etapa. */
export async function puedeEditarSyh(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const nivel = await nivelSyhDe(supabase, userId);
  return nivel === "edicion" || nivel === "admin";
}

/** Evaluar el riesgo, asignar, cerrar y reabrir. */
export async function esAdminSyh(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelSyhDe(supabase, userId)) === "admin";
}
