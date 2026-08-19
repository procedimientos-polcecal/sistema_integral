import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Compras.
 *
 * Los tres niveles del núcleo se mapean así:
 *   lectura → consulta
 *   edicion → gestiona la compra (proveedor, comparativa, costos, estados)
 *   admin   → además aprueba o deniega
 *
 * Aprobar es más restrictivo que comprar a propósito: es una decisión de
 * gerencia sobre el gasto, no una tarea operativa.
 *
 * El alta de un RI queda fuera de este esquema: la puede hacer cualquier
 * usuario activo del sistema (ver 018_compras_rls.sql).
 */

export async function nivelComprasDe(
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

  return nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "compras");
}

export async function puedeEditarCompras(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const nivel = await nivelComprasDe(supabase, userId);
  return nivel === "edicion" || nivel === "admin";
}

export async function puedeAprobarCompras(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelComprasDe(supabase, userId)) === "admin";
}

export async function tieneAccesoCompras(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelComprasDe(supabase, userId)) !== null;
}

/** Los tres permisos en una sola consulta, para las páginas del módulo. */
export interface PermisosCompras {
  nivel: UsuarioModulo["nivel"] | null;
  puedeEditar: boolean;
  puedeAprobar: boolean;
  tieneAcceso: boolean;
}

export async function permisosComprasDe(
  supabase: SupabaseClient,
  userId: string
): Promise<PermisosCompras> {
  const nivel = await nivelComprasDe(supabase, userId);
  return {
    nivel,
    puedeEditar: nivel === "edicion" || nivel === "admin",
    puedeAprobar: nivel === "admin",
    tieneAcceso: nivel !== null,
  };
}
