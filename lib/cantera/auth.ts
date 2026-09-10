import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Cantera.
 *
 *   lectura → ver los yacimientos, las voladuras y el informe
 *   edicion → además cargar y corregir perforación / voladura / bochones / consumos
 *   admin   → además los catálogos (canteras, insumos) y la lista de finanzas
 *
 * En la base los espejan `tiene_acceso_cantera()`, `puede_editar_cantera()` y
 * `es_admin_cantera()` (migración 20260910103229). **Las dos mitades tienen que
 * decir lo mismo**: cuando no coincidieron, en la 029, la pantalla mostraba los
 * botones y RLS devolvía listas vacías.
 *
 * `puedeFacturarCantera` es ortogonal a los tres niveles: sale de estar en
 * `cantera_finanzas`, igual que aprobar en Compras sale de una lista. Cargar una
 * voladura y conciliar su factura las hacen personas distintas.
 */

export async function nivelCanteraDe(
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

  return nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "cantera");
}

export async function tieneAccesoCantera(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelCanteraDe(supabase, userId)) !== null;
}

export async function puedeEditarCantera(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const nivel = await nivelCanteraDe(supabase, userId);
  return nivel === "edicion" || nivel === "admin";
}

export async function esAdminCantera(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelCanteraDe(supabase, userId)) === "admin";
}

/**
 * Está en `cantera_finanzas`: puede vincular una factura de Odoo a una etapa y
 * marcar la conciliación. A propósito NO alcanza con ser admin del módulo ni del
 * sistema — es la misma regla que `puedeAprobarOS`.
 */
export async function puedeFacturarCantera(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("cantera_finanzas")
    .select("usuario_id")
    .eq("usuario_id", userId)
    .maybeSingle();
  return Boolean(data);
}

export interface PersonaDeFinanzas {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
}

/** Quiénes están en la lista de finanzas, para la pantalla de configuración. */
export async function finanzasDeCantera(
  supabase: SupabaseClient
): Promise<PersonaDeFinanzas[]> {
  const { data } = await supabase
    .from("cantera_finanzas")
    .select("usuarios(id, nombre, apellido, email, activo)");

  type U = { id: string; nombre: string; apellido: string; email: string; activo: boolean };

  return (data ?? [])
    .map((fila) => fila.usuarios as unknown as U | null)
    .filter((u): u is U => Boolean(u?.activo))
    .map((u) => ({ id: u.id, nombre: u.nombre, apellido: u.apellido, email: u.email }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

export interface PermisosCantera {
  nivel: UsuarioModulo["nivel"] | null;
  puedeEditar: boolean;
  esAdmin: boolean;
  puedeFacturar: boolean;
  tieneAcceso: boolean;
}

export async function permisosCanteraDe(
  supabase: SupabaseClient,
  userId: string
): Promise<PermisosCantera> {
  const [nivel, puedeFacturar] = await Promise.all([
    nivelCanteraDe(supabase, userId),
    puedeFacturarCantera(supabase, userId),
  ]);

  return {
    nivel,
    puedeEditar: nivel === "edicion" || nivel === "admin",
    esAdmin: nivel === "admin",
    puedeFacturar,
    tieneAcceso: nivel !== null,
  };
}
