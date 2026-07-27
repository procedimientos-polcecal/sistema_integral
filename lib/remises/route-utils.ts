import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { nivelRemisesDe } from "./auth";

/**
 * Verifica sesión + acceso al módulo Remises (cualquier nivel). Devuelve una
 * `NextResponse` de error para retornar tal cual desde el route handler, o
 * `null` si está todo bien.
 */
export async function tiene_acceso_check(supabase: SupabaseClient): Promise<NextResponse | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const nivel = await nivelRemisesDe(supabase, user.id);
  if (!nivel) return NextResponse.json({ error: "Sin acceso al módulo Remises" }, { status: 403 });
  return null;
}

/** Igual que `tiene_acceso_check`, pero exige nivel edicion/admin. */
export async function puede_editar_check(supabase: SupabaseClient): Promise<NextResponse | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const nivel = await nivelRemisesDe(supabase, user.id);
  if (nivel !== "edicion" && nivel !== "admin") {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }
  return null;
}

/** Igual que `tiene_acceso_check`, pero exige nivel admin. */
export async function es_admin_check(supabase: SupabaseClient): Promise<NextResponse | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const nivel = await nivelRemisesDe(supabase, user.id);
  if (nivel !== "admin") return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  return null;
}
