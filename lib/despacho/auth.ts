import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Despacho.
 *
 *   lectura  ve los movimientos diarios y el histórico
 *   edicion  además da de alta órdenes, marca horarios y corrige
 *   admin    además edita el mapeo de productos
 *
 * En la base los espejan `tiene_acceso_despacho()`, `puede_editar_despacho()` y
 * `es_admin_despacho()`. Las dos mitades tienen que decir lo mismo: es lo que la
 * 029 tuvo que corregir en Mantenimiento cuando un `admin_sistema` veía los
 * botones y RLS le devolvía listas vacías.
 */

export async function nivelDespachoDe(
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

  return nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "despacho");
}

/** Acceso al módulo, con cualquier nivel. Hace falta donde se usa el cliente admin: ahí RLS no corre. */
export async function tieneAccesoDespacho(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelDespachoDe(supabase, userId)) !== null;
}

/** Dar de alta órdenes, marcar horarios y corregir. */
export async function puedeEditarDespacho(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const nivel = await nivelDespachoDe(supabase, userId);
  return nivel === "edicion" || nivel === "admin";
}

/** Editar el mapeo de productos. */
export async function esAdminDespacho(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelDespachoDe(supabase, userId)) === "admin";
}
