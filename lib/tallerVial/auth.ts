import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Taller Vial.
 *
 *   lectura → ver las cargas y los resúmenes
 *   edicion → además cargar y borrar cargas
 *   admin   → sin uso propio todavía; queda para cuando haya catálogos
 *
 * En la base los espejan `tiene_acceso_taller_vial()`, `puede_editar_taller_vial()`
 * y `es_admin_taller_vial()` (migración 20260917094056). Las dos mitades
 * tienen que decir lo mismo — el mismo cuidado que Cantera (`lib/cantera/auth.ts`).
 */

export async function nivelTallerVialDe(
  supabase: SupabaseClient,
  userId: string
): Promise<UsuarioModulo["nivel"] | null> {
  // Las dos consultas no dependen una de la otra — en paralelo, no en
  // secuencia: esto se corre en cada carga de página del módulo.
  const [{ data: usuario }, { data: grants }] = await Promise.all([
    supabase.from("usuarios").select("rol").eq("id", userId).single(),
    supabase.from("usuario_modulos").select("id, usuario_id, modulo, nivel").eq("usuario_id", userId),
  ]);
  if (!usuario) return null;

  return nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "taller_vial");
}

export async function tieneAccesoTallerVial(supabase: SupabaseClient, userId: string): Promise<boolean> {
  return (await nivelTallerVialDe(supabase, userId)) !== null;
}

export async function puedeEditarTallerVial(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const nivel = await nivelTallerVialDe(supabase, userId);
  return nivel === "edicion" || nivel === "admin";
}

export async function esAdminTallerVial(supabase: SupabaseClient, userId: string): Promise<boolean> {
  return (await nivelTallerVialDe(supabase, userId)) === "admin";
}

export interface PermisosTallerVial {
  nivel: UsuarioModulo["nivel"] | null;
  puedeEditar: boolean;
  esAdmin: boolean;
  tieneAcceso: boolean;
}

export async function permisosTallerVialDe(supabase: SupabaseClient, userId: string): Promise<PermisosTallerVial> {
  const nivel = await nivelTallerVialDe(supabase, userId);
  return {
    nivel,
    puedeEditar: nivel === "edicion" || nivel === "admin",
    esAdmin: nivel === "admin",
    tieneAcceso: nivel !== null,
  };
}
