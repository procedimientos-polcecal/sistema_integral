import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Mantenimiento.
 *
 * Los tres niveles del núcleo se mapean así:
 *   lectura → consulta
 *   edicion → opera: OT, avisos, ejecuciones, producción, órdenes de servicio
 *   admin   → además configura el catálogo: tipos, contratistas, operarios
 *
 * En la base los espejan `mant_puede_ver()`, `mant_puede_editar()` y
 * `mant_es_admin()`. Las dos mitades tienen que decir lo mismo: la migración
 * 029 alineó `mant_nivel()` con `nivelEnModulo()` para que un `admin_sistema`
 * tenga admin de los dos lados.
 *
 * La guía de integración propone crear un helper `mantNivel`: no hace falta,
 * es lo que hace `nivelMantenimientoDe()` desde antes.
 */

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

/**
 * Administrar el módulo: tipos de equipo, contratistas, operarios.
 *
 * Es el espejo en el código de `mant_es_admin()` en la base, y la contraparte
 * de `puedeEditarMantenimiento()`: operar es una cosa, configurar el catálogo
 * con el que después todos trabajan es otra.
 */
export async function esAdminMantenimiento(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelMantenimientoDe(supabase, userId)) === "admin";
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
