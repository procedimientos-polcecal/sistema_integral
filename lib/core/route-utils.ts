import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Verifica sesión + rol admin_sistema/admin (a nivel núcleo, no de módulo).
 * Refleja exactamente `public.es_admin()` de la base (002_nucleo_rls.sql)
 * para que el guard de la app nunca sea más estricto que lo que ya permite RLS.
 * Devuelve una `NextResponse` de error para retornar tal cual, o `null` si está todo bien.
 */
export async function es_admin_check(supabase: SupabaseClient): Promise<NextResponse | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  if (!usuario || (usuario.rol !== "admin_sistema" && usuario.rol !== "admin")) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  return null;
}
