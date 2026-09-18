import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Trituración. Calcado de `lib/cantera/auth.ts` y
 * `lib/tallerVial/auth.ts`:
 *
 *   lectura → ver los partes y el informe
 *   edicion → además cargar y corregir un parte
 *   admin   → además el catálogo de plantas
 *
 * En la base los espejan `tiene_acceso_trituracion()`,
 * `puede_editar_trituracion()` y `es_admin_trituracion()` (migración
 * 20260918105944). Las dos mitades tienen que decir lo mismo.
 */

export async function nivelTrituracionDe(
  supabase: SupabaseClient,
  userId: string
): Promise<UsuarioModulo["nivel"] | null> {
  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", userId).single();
  if (!usuario) return null;

  const { data: grants } = await supabase
    .from("usuario_modulos")
    .select("id, usuario_id, modulo, nivel")
    .eq("usuario_id", userId);

  return nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "trituracion");
}

export async function tieneAccesoTrituracion(supabase: SupabaseClient, userId: string): Promise<boolean> {
  return (await nivelTrituracionDe(supabase, userId)) !== null;
}

export async function puedeEditarTrituracion(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const nivel = await nivelTrituracionDe(supabase, userId);
  return nivel === "edicion" || nivel === "admin";
}

export async function esAdminTrituracion(supabase: SupabaseClient, userId: string): Promise<boolean> {
  return (await nivelTrituracionDe(supabase, userId)) === "admin";
}

export interface PermisosTrituracion {
  nivel: UsuarioModulo["nivel"] | null;
  puedeEditar: boolean;
  esAdmin: boolean;
  tieneAcceso: boolean;
}

export async function permisosTrituracionDe(
  supabase: SupabaseClient,
  userId: string
): Promise<PermisosTrituracion> {
  const nivel = await nivelTrituracionDe(supabase, userId);
  return {
    nivel,
    puedeEditar: nivel === "edicion" || nivel === "admin",
    esAdmin: nivel === "admin",
    tieneAcceso: nivel !== null,
  };
}
