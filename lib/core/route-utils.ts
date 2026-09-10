import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { esAdminDelNucleo } from "./access";

/**
 * Verifica sesión + administrador del núcleo, que es **sólo `admin_sistema`**
 * (ver `esAdminDelNucleo`, que es donde vive la regla y por qué).
 *
 * Gatea las nueve rutas de `/api/administracion` —usuarios, sus permisos, sus
 * áreas, el link de acceso, empresas y sectores— y las tres de `/api/odoo`.
 * Seis de esas nueve escriben con `createAdminClient()`, que **no pasa por
 * RLS**: ahí este chequeo no es una segunda línea de defensa, es la única.
 *
 * Antes decía `admin_sistema || admin` y su comentario decía que reflejaba
 * `public.es_admin()` de la base "para que el guard nunca sea más estricto que
 * lo que ya permite RLS". Ese espejo ahora apunta a `es_admin_sistema()`. Hasta
 * que corra la migración que cierra las policies de escritura del núcleo, la
 * app queda **más estricta** que RLS, que es el lado seguro: la pantalla y las
 * rutas ya no dejan pasar a `admin` aunque la base todavía lo dejaría.
 *
 * Devuelve una `NextResponse` de error para retornar tal cual, o `null` si está
 * todo bien.
 */
export async function es_admin_check(supabase: SupabaseClient): Promise<NextResponse | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  if (!esAdminDelNucleo(usuario?.rol)) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  return null;
}
