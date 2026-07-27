import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoStaging = "empleados" | "fichadas";

export async function crearStaging(
  supabase: SupabaseClient,
  usuarioId: string,
  tipo: TipoStaging,
  datos: unknown
): Promise<string> {
  const { data, error } = await supabase
    .from("rrhh_import_staging")
    .insert({ usuario_id: usuarioId, tipo, datos })
    .select("token")
    .single();
  if (error || !data) throw new Error(`No se pudo guardar el preview: ${error?.message}`);
  return data.token as string;
}

export async function leerStaging<T = unknown>(
  supabase: SupabaseClient,
  token: string,
  tipo: TipoStaging
): Promise<T | null> {
  const { data } = await supabase
    .from("rrhh_import_staging")
    .select("datos, expires_at")
    .eq("token", token)
    .eq("tipo", tipo)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at as string) < new Date()) return null;
  return data.datos as T;
}

export async function borrarStaging(supabase: SupabaseClient, token: string): Promise<void> {
  await supabase.from("rrhh_import_staging").delete().eq("token", token);
}
