import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Facturación.
 *
 *   lectura → ver el buzón y qué llegó
 *   edicion → además subir facturas, imputarlas y crear el borrador en Odoo
 *   admin   → además **confirmar** ese borrador, o sea postear el asiento
 *
 * En la base los espejan `tiene_acceso_facturacion()` y
 * `puede_editar_facturacion()` (migración 20260910080315). **Las dos mitades
 * tienen que decir lo mismo**: cuando no coinciden, la pantalla muestra los
 * botones y RLS devuelve listas vacías, que es lo que la 029 tuvo que corregir
 * en Mantenimiento.
 *
 * No hay nivel para borrar y no es un olvido: una factura que llegó, llegó. Si
 * se cargó mal se corrige, y si no era del grupo se anota en `notas`.
 *
 * `admin` acá es el nivel del **módulo** (`usuario_modulos.nivel = 'admin'`), que
 * es lo que devuelve `nivelEnModulo`; `admin_sistema` lo tiene por rol. No es el
 * `rol = 'admin'` del núcleo, que administra usuarios y empresas pero no opera
 * dentro de los módulos — ver la migración 20260908083338.
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

/**
 * Confirmar el borrador en Odoo, o sea **postear el asiento**.
 *
 * Es el único permiso del módulo que pide `admin`, y el motivo es que es la
 * única acción que **no se deshace**: un asiento posteado es inmutable, Odoo le
 * asigna la numeración del diario y corregirlo después es reabrirlo o
 * reversarlo, que ya es una operación contable.
 *
 * Cargar la factura, imputarla y dejar el borrador armado siguen siendo de
 * `edicion`: son el trabajo de todos los días y todo eso se corrige. Lo que se
 * reserva es el último paso.
 *
 * No tiene función espejo en la base porque no hay policy que lo custodie: el
 * posteo no es un `insert` ni un `update` sobre una tabla nuestra, es una
 * llamada a Odoo. La puerta es esta función y la ruta que la usa.
 */
export async function puedeConfirmarEnOdoo(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return (await nivelFacturacionDe(supabase, userId)) === "admin";
}
