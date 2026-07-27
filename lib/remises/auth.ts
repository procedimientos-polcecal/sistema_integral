import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

export async function nivelRemisesDe(
  supabase: SupabaseClient,
  userId: string
): Promise<UsuarioModulo["nivel"] | null> {
  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", userId).single();
  if (!usuario) return null;

  const { data: grants } = await supabase
    .from("usuario_modulos")
    .select("id, usuario_id, modulo, nivel")
    .eq("usuario_id", userId);

  return nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "remises");
}

export async function puedeEditarRemises(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const nivel = await nivelRemisesDe(supabase, userId);
  return nivel === "edicion" || nivel === "admin";
}

export async function esAdminRemises(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const nivel = await nivelRemisesDe(supabase, userId);
  return nivel === "admin";
}
