import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

export async function nivelMantenimientoDe(
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

  return nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "mantenimiento");
}

export async function puedeEditarMantenimiento(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const nivel = await nivelMantenimientoDe(supabase, userId);
  return nivel === "edicion" || nivel === "admin";
}

export interface UsuarioBasico {
  id: string;
  nombre: string;
  apellido: string;
  rol: Rol;
}

// Usuarios asignables dentro del módulo: admin_sistema (ven todo) + quienes
// tengan un grant explícito de usuario_modulos(mantenimiento). Evita listar
// en Mantenimiento a usuarios que sólo tienen acceso a RRHH/Remises.
export async function usuariosConAccesoMantenimiento(
  supabase: SupabaseClient
): Promise<UsuarioBasico[]> {
  const [{ data: admins }, { data: grants }] = await Promise.all([
    supabase.from("usuarios").select("id, nombre, apellido, rol").eq("activo", true).eq("rol", "admin_sistema"),
    supabase
      .from("usuario_modulos")
      .select("usuarios(id, nombre, apellido, rol, activo)")
      .eq("modulo", "mantenimiento"),
  ]);

  const map = new Map<string, UsuarioBasico>();
  for (const u of admins ?? []) map.set(u.id, u as UsuarioBasico);
  for (const g of grants ?? []) {
    const u = g.usuarios as unknown as (UsuarioBasico & { activo: boolean }) | null;
    if (u?.activo) map.set(u.id, { id: u.id, nombre: u.nombre, apellido: u.apellido, rol: u.rol });
  }
  return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
}
