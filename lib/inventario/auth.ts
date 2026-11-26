import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Inventario.
 *
 * Los tres roles que traía la app de origen mapean uno a uno con los niveles
 * que el núcleo ya tiene, así que no hace falta un vocabulario nuevo:
 *
 *   consulta → lectura   ver stock, artículos y faltantes
 *   operador → edicion   además registra entradas, salidas y ajustes
 *   admin    → admin     además da de alta y edita artículos
 *
 * En la base los espejan `tiene_acceso_inventario()`,
 * `puede_editar_inventario()` y `es_admin_inventario()` (migración 046). Las dos
 * mitades tienen que decir lo mismo: es lo que la 029 tuvo que corregir en
 * Mantenimiento cuando un `admin_sistema` veía los botones y RLS le devolvía
 * listas vacías.
 */

export async function nivelInventarioDe(
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

  return nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "inventario");
}

/**
 * Acceso al módulo, con cualquier nivel.
 *
 * Hace falta en las rutas que trabajan con el cliente admin: ahí RLS no corre,
 * así que la policy de la base no las cubre y el permiso hay que comprobarlo en
 * el código.
 */
export async function tieneAccesoInventario(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelInventarioDe(supabase, userId)) !== null;
}

/**
 * Qué niveles pueden escribir en Inventario.
 *
 * Vive acá y no repetido en cada lado porque una pantalla que muestra el botón
 * y una ruta que lo rechaza son el mismo error visto de los dos lados, y el
 * día que el umbral cambie se corrige en un solo lugar. Lo usan
 * `puedeEditarInventario` —que es lo que miran las rutas— y la página de «Para
 * reponer», que ya tiene el nivel en la mano y no necesita preguntarlo de
 * nuevo.
 */
export const esNivelDeEdicion = (nivel: UsuarioModulo["nivel"] | null) =>
  nivel === "edicion" || nivel === "admin";

/** Registrar movimientos. Es el `operador` de la app de origen. */
export async function puedeEditarInventario(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return esNivelDeEdicion(await nivelInventarioDe(supabase, userId));
}

/** Dar de alta y editar artículos. */
export async function esAdminInventario(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelInventarioDe(supabase, userId)) === "admin";
}
