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

/**
 * Aprobar exige el permiso explícito del módulo con nivel admin.
 *
 * A diferencia del resto, acá NO alcanza con ser admin del sistema: la planilla
 * restringe la columna de aprobación a una lista de personas y la app espeja
 * esa misma lista. Si un admin pudiera aprobar sin estar en ella, los dos lados
 * dirían cosas distintas sobre quién aprueba, que es justo lo que hay que
 * evitar mientras convivan.
 *
 * Por eso se consulta el grant directo y no nivelEnModulo(), que le devuelve
 * "admin" a cualquier admin_sistema.
 */
export async function puedeAprobarCompras(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("usuario_modulos")
    .select("nivel")
    .eq("usuario_id", userId)
    .eq("modulo", "compras")
    .maybeSingle();

  return data?.nivel === "admin";
}

/** Quiénes pueden aprobar hoy. Se compara con la lista de la planilla. */
export interface Aprobador {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
}

export async function aprobadoresDeCompras(supabase: SupabaseClient): Promise<Aprobador[]> {
  const { data } = await supabase
    .from("usuario_modulos")
    .select("usuarios(id, nombre, apellido, email, activo)")
    .eq("modulo", "compras")
    .eq("nivel", "admin");

  return (data ?? [])
    .map((g) => g.usuarios as unknown as (Aprobador & { activo: boolean }) | null)
    .filter((u): u is Aprobador & { activo: boolean } => Boolean(u?.activo))
    .map(({ id, nombre, apellido, email }) => ({ id, nombre, apellido, email }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
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
  const [nivel, puedeAprobar] = await Promise.all([
    nivelComprasDe(supabase, userId),
    // Va aparte porque la regla es más estricta: ver puedeAprobarCompras().
    puedeAprobarCompras(supabase, userId),
  ]);

  return {
    nivel,
    puedeEditar: nivel === "edicion" || nivel === "admin",
    puedeAprobar,
    tieneAcceso: nivel !== null,
  };
}
