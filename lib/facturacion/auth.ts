import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Facturación.
 *
 *   lectura → ver el buzón y qué llegó
 *   edicion → además subir facturas y vincularlas a un requerimiento
 *   admin   → por ahora lo mismo que edición
 *
 * En la base los espejan `tiene_acceso_facturacion()` y
 * `puede_editar_facturacion()` (migración 20260910080315). **Las dos mitades
 * tienen que decir lo mismo**: cuando no coinciden, la pantalla muestra los
 * botones y RLS devuelve listas vacías, que es lo que la 029 tuvo que corregir
 * en Mantenimiento.
 *
 * No hay nivel para borrar y no es un olvido: una factura que llegó, llegó. Si
 * se cargó mal se corrige, y si no era del grupo se anota en `notas`.
 */

export async function nivelFacturacionDe(
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

  return nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "facturacion");
}

/** Acceso al módulo, con cualquier nivel. */
export async function tieneAccesoFacturacion(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelFacturacionDe(supabase, userId)) !== null;
}

/**
 * Cargar facturas al buzón y vincularlas.
 *
 * Hace falta comprobarlo en el código además de en RLS: la ruta que sube el
 * archivo usa el cliente admin —Storage con la service role— y ahí las policies
 * de la base no corren.
 */
export async function puedeEditarFacturacion(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const nivel = await nivelFacturacionDe(supabase, userId);
  return nivel === "edicion" || nivel === "admin";
}
