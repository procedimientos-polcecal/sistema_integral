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
 * Aprobar es estar en la lista, no tener un nivel.
 *
 * A diferencia del resto, acá NO alcanza con ser admin del sistema ni admin del
 * módulo: la planilla restringe la columna de aprobación a ciertas cuentas y la
 * app espeja esa misma regla. Administrar el módulo y autorizar un gasto son
 * cosas distintas, y las hacen personas distintas.
 *
 * Vale para las dos aprobaciones: la del requerimiento y la de la compra.
 */
export async function puedeAprobarCompras(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("compras_aprobadores")
    .select("usuario_id")
    .eq("usuario_id", userId)
    .maybeSingle();

  return Boolean(data);
}

/**
 * Aprobar una **orden de servicio**: su propia lista, `os_aprobadores`.
 *
 * Separada de `compras_aprobadores` a propósito: aprobar un servicio y aprobar
 * un material los decide gente distinta, y una lista que hereda de la otra en
 * silencio no permite que se separen después.
 *
 * Vive en este archivo aunque la OS sea una entidad de Mantenimiento porque es
 * un permiso que leen las pantallas de Compras —Aprobaciones es donde se
 * ejerce— y porque las dos listas se administran juntas en Configuración de
 * Compras. Tenerlas separadas era garantizar que la próxima persona encontrara
 * una y no la otra.
 *
 * **Ojo:** estar en la lista no alcanza para llegar a la pantalla. Aprobaciones
 * vive bajo `/compras`, cuyo layout manda a `/mis-pedidos` a quien no tenga el
 * módulo. Sumar a alguien acá sin darle Compras no hace nada visible.
 */
export async function puedeAprobarOS(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("os_aprobadores")
    .select("usuario_id")
    .eq("usuario_id", userId)
    .maybeSingle();

  return Boolean(data);
}

/** Administrar el módulo: entre otras cosas, quién está en la lista. */
export async function esAdminCompras(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelComprasDe(supabase, userId)) === "admin";
}

/** Quiénes pueden aprobar. Es la misma fuente que el permiso. */
export interface Aprobador {
  id: string;
  nombre: string;
  apellido: string;
  email: string;
  alias: string | null;
}

export async function aprobadoresDeCompras(supabase: SupabaseClient): Promise<Aprobador[]> {
  const { data } = await supabase
    .from("compras_aprobadores")
    .select("alias_planilla, usuarios(id, nombre, apellido, email, activo)");

  type Usuario = { id: string; nombre: string; apellido: string; email: string; activo: boolean };

  return (data ?? [])
    .map((fila) => ({
      alias: (fila.alias_planilla ?? null) as string | null,
      usuario: fila.usuarios as unknown as Usuario | null,
    }))
    .filter((f): f is { alias: string | null; usuario: Usuario } => Boolean(f.usuario?.activo))
    .map(({ alias, usuario }) => ({
      id: usuario.id,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      email: usuario.email,
      alias,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

/**
 * Quiénes pueden aprobar una orden de servicio.
 *
 * Sin alias, que es la única diferencia con `aprobadoresDeCompras()`: la
 * planilla de OS no firma la aprobación.
 */
export async function aprobadoresDeOS(
  supabase: SupabaseClient
): Promise<Omit<Aprobador, "alias">[]> {
  const { data } = await supabase
    .from("os_aprobadores")
    .select("usuarios(id, nombre, apellido, email, activo)");

  type Usuario = { id: string; nombre: string; apellido: string; email: string; activo: boolean };

  return (data ?? [])
    .map((fila) => fila.usuarios as unknown as Usuario | null)
    .filter((u): u is Usuario => Boolean(u?.activo))
    .map((u) => ({ id: u.id, nombre: u.nombre, apellido: u.apellido, email: u.email }))
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
  /** Está en `os_aprobadores`: decide sobre las órdenes de servicio. */
  puedeAprobarOS: boolean;
  tieneAcceso: boolean;
}

export async function permisosComprasDe(
  supabase: SupabaseClient,
  userId: string
): Promise<PermisosCompras> {
  const [nivel, puedeAprobar, aprobarOS] = await Promise.all([
    nivelComprasDe(supabase, userId),
    // Van aparte porque la regla es más estricta: ver puedeAprobarCompras().
    // Y son dos listas distintas: un material y un servicio no los aprueba
    // necesariamente la misma persona.
    puedeAprobarCompras(supabase, userId),
    puedeAprobarOS(supabase, userId),
  ]);

  return {
    nivel,
    puedeEditar: nivel === "edicion" || nivel === "admin",
    puedeAprobar,
    puedeAprobarOS: aprobarOS,
    tieneAcceso: nivel !== null,
  };
}
