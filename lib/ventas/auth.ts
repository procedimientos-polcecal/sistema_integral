import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Ventas.
 *
 *   lectura  ve clientes, contactos, oportunidades y el registro de actividades
 *   edicion  además carga y corrige todo eso, y mueve una oportunidad de etapa
 *   admin    además borra un cliente (con todo lo que cuelga), borra
 *            actividades y oportunidades, reasigna el vendedor y enlaza con Odoo
 *
 * En la base los espejan `tiene_acceso_ventas()`, `puede_editar_ventas()` y
 * `es_admin_ventas()`. Las dos mitades tienen que decir lo mismo: es lo que la
 * 029 tuvo que corregir en Mantenimiento cuando un `admin_sistema` veía los
 * botones y RLS le devolvía listas vacías.
 *
 * ── «NO TIENE PERMISO» Y «NO SE PUDO AVERIGUAR» SON DOS COSAS DISTINTAS ─────
 *
 * Esta forma —un resultado que puede decir que no se sabe— es la que
 * Seguridad e Higiene tuvo que adoptar el 31/10/2026 después de que descartar
 * el `error` de las dos lecturas hiciera que una caída de la base contestara
 * **403**. Allá el costo era grave y concreto (para la cola sin señal un 403 es
 * definitivo: la carga queda parada y a quien está en la planta se le dice que
 * no tiene permiso cuando sí lo tiene).
 *
 * Acá el CRM no tiene cola offline y el costo es más chico, pero se escribe
 * así igual por dos razones: un 403 por una caída pasajera le dice a un
 * vendedor que le sacaron el acceso —y lo que hace después es escribirle a
 * alguien, no reintentar—, y copiar la forma barata significaría que el día que
 * este módulo sí tenga carga desde el teléfono haya que volver a recorrer cada
 * ruta. La diferencia entre los dos códigos cuesta lo mismo escribirla ahora.
 */

/** El nivel de alguien en el módulo, o por qué no se pudo averiguar. */
export type NivelVentas =
  | { ok: true; nivel: UsuarioModulo["nivel"] | null }
  | { ok: false; error: string };

/** Lo mismo para las tres preguntas de sí o no. */
export type PermisoVentas = { ok: true; si: boolean } | { ok: false; error: string };

export async function nivelVentasDe(
  supabase: SupabaseClient,
  userId: string
): Promise<NivelVentas> {
  // `maybeSingle` y no `single`: un usuario que no está es `null` sin error, y
  // eso sí es «no tiene acceso». Lo que no puede confundirse con eso es que la
  // lectura falle.
  const { data: usuario, error: errorDelUsuario } = await supabase
    .from("usuarios")
    .select("rol")
    .eq("id", userId)
    .maybeSingle();
  if (errorDelUsuario) return { ok: false, error: errorDelUsuario.message };
  if (!usuario) return { ok: true, nivel: null };

  const { data: grants, error: errorDeLosGrants } = await supabase
    .from("usuario_modulos")
    .select("id, usuario_id, modulo, nivel")
    .eq("usuario_id", userId);
  if (errorDeLosGrants) return { ok: false, error: errorDeLosGrants.message };

  return {
    ok: true,
    nivel: nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "ventas"),
  };
}

/** Acceso al módulo, con cualquier nivel. Hace falta donde se usa el cliente admin: ahí RLS no corre. */
export async function tieneAccesoVentas(
  supabase: SupabaseClient,
  userId: string
): Promise<PermisoVentas> {
  return comoPermiso(await nivelVentasDe(supabase, userId), (nivel) => nivel !== null);
}

/** Cargar y corregir clientes, contactos, oportunidades y actividades. */
export async function puedeEditarVentas(
  supabase: SupabaseClient,
  userId: string
): Promise<PermisoVentas> {
  return comoPermiso(
    await nivelVentasDe(supabase, userId),
    (nivel) => nivel === "edicion" || nivel === "admin"
  );
}

/** Borrar, reasignar el vendedor y enlazar con Odoo. */
export async function esAdminVentas(
  supabase: SupabaseClient,
  userId: string
): Promise<PermisoVentas> {
  return comoPermiso(await nivelVentasDe(supabase, userId), (nivel) => nivel === "admin");
}

function comoPermiso(
  resultado: NivelVentas,
  alcanza: (nivel: UsuarioModulo["nivel"] | null) => boolean
): PermisoVentas {
  return resultado.ok ? { ok: true, si: alcanza(resultado.nivel) } : resultado;
}

/**
 * Lo que contesta una ruta cuando no se pudo averiguar el nivel: **503 y no
 * 403**, con lo que dijo la base sin traducir.
 *
 * Vive acá y no en cada ruta porque la diferencia entre los dos códigos es toda
 * la razón de ser del resultado de arriba: escrita ocho veces, un día una de
 * las ocho vuelve a ser un 403.
 */
export function noSePudoAveriguar(falla: { error: string }): NextResponse {
  return NextResponse.json(
    {
      error:
        `No se pudieron comprobar tus permisos de Ventas: ${falla.error}. ` +
        `No quiere decir que no los tengas: volvé a intentarlo.`,
    },
    { status: 503 }
  );
}
