import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

/**
 * Permisos del módulo Seguridad e Higiene.
 *
 *   lectura  ve la tabla de condiciones y sus fotos
 *   edicion  además carga una condición y corrige su primera etapa (lugar,
 *            descripción, peligro, acción, prioridad) mientras no esté cerrada
 *   admin    además evalúa el riesgo, asigna, cierra, reabre y corrige lo ya
 *            evaluado
 *
 * En la base los espejan `tiene_acceso_syh()`, `puede_editar_syh()` y
 * `es_admin_syh()`. Las dos mitades tienen que decir lo mismo: es lo que la
 * 029 tuvo que corregir en Mantenimiento cuando un `admin_sistema` veía los
 * botones y RLS le devolvía listas vacías.
 *
 * ── «NO TIENE PERMISO» Y «NO SE PUDO AVERIGUAR» SON DOS COSAS DISTINTAS ─────
 *
 * Hasta el 31/10/2026 estas funciones descartaban el `error` de sus dos
 * lecturas (`const { data } = await …`), así que una caída de la base daba
 * `grants ?? []` → `[]` → sin acceso, y la ruta contestaba **403**. Dos cosas
 * lo vuelven caro, y las dos son del teléfono:
 *
 *   * **Para la cola sin señal un 403 es definitivo** (`clasificarFallo`). La
 *     carga queda `parada`, deja de reintentarse sola, y a quien está parado
 *     frente al problema se le dice que no tiene permiso cuando sí lo tiene.
 *     La ruta de alta ya explicaba en cinco renglones que esto no puede pasar
 *     —por eso su lectura de `usuarios.activo` contesta 503— y dos llamadas
 *     después llamaba a esto.
 *   * **Un 403 de `/peligros` le borra al teléfono el permiso cacheado y la
 *     lista de peligros**: esa respuesta *es* «esta persona no puede cargar».
 *     La persona se va a la cantera y ya no puede cargar nada.
 *
 * Por eso el nivel viaja en un resultado que puede decir que no se sabe, y las
 * rutas contestan 503 con `noSePudoAveriguar`. El modo de fallar seguro acá no
 * es negar el acceso: es decir que no se sabe.
 */

/** El nivel de alguien en el módulo, o por qué no se pudo averiguar. */
export type NivelSyh =
  | { ok: true; nivel: UsuarioModulo["nivel"] | null }
  | { ok: false; error: string };

/** Lo mismo para las tres preguntas de sí o no. */
export type PermisoSyh = { ok: true; si: boolean } | { ok: false; error: string };

export async function nivelSyhDe(
  supabase: SupabaseClient,
  userId: string
): Promise<NivelSyh> {
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
    nivel: nivelEnModulo(
      usuario.rol as Rol,
      (grants ?? []) as UsuarioModulo[],
      "seguridad_higiene"
    ),
  };
}

/** Acceso al módulo, con cualquier nivel. Hace falta donde se usa el cliente admin: ahí RLS no corre. */
export async function tieneAccesoSyh(
  supabase: SupabaseClient,
  userId: string
): Promise<PermisoSyh> {
  return comoPermiso(await nivelSyhDe(supabase, userId), (nivel) => nivel !== null);
}

/** Cargar una condición y corregir su primera etapa. */
export async function puedeEditarSyh(
  supabase: SupabaseClient,
  userId: string
): Promise<PermisoSyh> {
  return comoPermiso(
    await nivelSyhDe(supabase, userId),
    (nivel) => nivel === "edicion" || nivel === "admin"
  );
}

/** Evaluar el riesgo, asignar, cerrar y reabrir. */
export async function esAdminSyh(
  supabase: SupabaseClient,
  userId: string
): Promise<PermisoSyh> {
  return comoPermiso(await nivelSyhDe(supabase, userId), (nivel) => nivel === "admin");
}

function comoPermiso(
  resultado: NivelSyh,
  alcanza: (nivel: UsuarioModulo["nivel"] | null) => boolean
): PermisoSyh {
  return resultado.ok ? { ok: true, si: alcanza(resultado.nivel) } : resultado;
}

/**
 * Lo que contesta una ruta cuando no se pudo averiguar el nivel: **503 y no
 * 403**, con lo que dijo la base sin traducir.
 *
 * Vive acá y no en cada ruta porque la diferencia entre los dos códigos es toda
 * la razón de ser del resultado de arriba: escrita cinco veces, un día una de
 * las cinco vuelve a ser un 403 y lo que se rompe es el camino sin señal, que
 * es el que nadie mira.
 */
export function noSePudoAveriguar(falla: { error: string }): NextResponse {
  return NextResponse.json(
    {
      error:
        `No se pudieron comprobar tus permisos de Seguridad e Higiene: ${falla.error}. ` +
        `No quiere decir que no los tengas: volvé a intentarlo.`,
    },
    { status: 503 }
  );
}
