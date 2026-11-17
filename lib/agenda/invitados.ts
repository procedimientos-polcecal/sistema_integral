import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Los invitados de un evento en la base.
 *
 * `agenda_invitados` **no tiene policy de update**: un invitado se agrega o se
 * saca, no se reescribe. Por eso cambiar la lista es borrar los que sobran e
 * insertar los que faltan —nunca un `upsert` ni un `on conflict do update`, que
 * PostgREST resuelve con `merge-duplicates` y falla sin esa policy—. Y sólo se
 * tocan **las diferencias**: reemplazar todo con borrar-y-reinsertar dejaría
 * al evento sin invitados si el insert falla a la mitad.
 */

/** Qué usuarios del SdG hay detrás de estos correos; el resto queda en null (un externo). */
export async function usuarioIdsDe(
  supabase: SupabaseClient,
  correos: string[]
): Promise<{ ok: true; ids: Map<string, string> } | { ok: false; error: string }> {
  const ids = new Map<string, string>();
  if (correos.length === 0) return { ok: true, ids };
  // Hasta 50 correos (lo topea el esquema): entran de sobra en una URL.
  const { data, error } = await supabase.from("usuarios").select("id, email").in("email", correos);
  if (error) return { ok: false, error: error.message };
  for (const u of data ?? []) if (u.email) ids.set(u.email.toLowerCase(), u.id);
  return { ok: true, ids };
}

/** Agrega estos invitados al evento. Devuelve el error, o null si quedaron. */
export async function agregarInvitados(
  supabase: SupabaseClient,
  eventoId: string,
  correos: string[]
): Promise<string | null> {
  if (correos.length === 0) return null;
  const usuarios = await usuarioIdsDe(supabase, correos);
  if (!usuarios.ok) return `No se pudieron buscar los invitados: ${usuarios.error}`;
  const { error } = await supabase.from("agenda_invitados").insert(
    correos.map((email) => ({ evento_id: eventoId, email, usuario_id: usuarios.ids.get(email) ?? null }))
  );
  return error ? `No se pudieron guardar los invitados: ${error.message}` : null;
}

/** Saca estos invitados del evento. Devuelve el error, o null si se fueron. */
export async function sacarInvitados(
  supabase: SupabaseClient,
  eventoId: string,
  correos: string[]
): Promise<string | null> {
  if (correos.length === 0) return null;
  const { error } = await supabase
    .from("agenda_invitados")
    .delete()
    .eq("evento_id", eventoId)
    .in("email", correos);
  return error ? `No se pudieron sacar los invitados: ${error.message}` : null;
}

/** Lo que cambia entre la lista de ahora y la nueva. Los correos ya vienen limpios (minúscula, sin repetidos). */
export function diferenciaDeInvitados(
  actuales: string[],
  nuevos: string[]
): { sacar: string[]; agregar: string[] } {
  const hoy = new Set(actuales);
  const queda = new Set(nuevos);
  return {
    sacar: actuales.filter((c) => !queda.has(c)),
    agregar: nuevos.filter((c) => !hoy.has(c)),
  };
}
