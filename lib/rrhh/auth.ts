import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelEnModulo } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

export async function nivelRrhhDe(
  supabase: SupabaseClient,
  userId: string
): Promise<UsuarioModulo["nivel"] | null> {
  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", userId).single();
  if (!usuario) return null;

  const { data: grants } = await supabase
    .from("usuario_modulos")
    .select("id, usuario_id, modulo, nivel")
    .eq("usuario_id", userId);

  return nivelEnModulo(usuario.rol as Rol, (grants ?? []) as UsuarioModulo[], "rrhh");
}

export async function puedeEditarRrhh(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const nivel = await nivelRrhhDe(supabase, userId);
  return nivel === "edicion" || nivel === "admin";
}

export async function esAdminRrhh(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const nivel = await nivelRrhhDe(supabase, userId);
  return nivel === "admin";
}
