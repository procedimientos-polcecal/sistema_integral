import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Quién llama a una ruta de la Agenda, o la respuesta con que se lo rechaza.
 *
 * La Agenda la ven los catorce y no es un módulo con permisos propios, así que
 * lo único que se comprueba es que haya sesión y que el usuario esté activo: un
 * usuario desactivado con la sesión viva no tiene que poder crear eventos en el
 * calendario de nadie. Lo demás lo resuelve RLS.
 *
 * `casilla` es el email del usuario y es **el calendario donde se escribe**: la
 * cuenta de servicio impersona esa casilla. Un fallo de la lectura es un 503 y
 * no un 403, para que una caída pasajera de la base no se disfrace de «tu
 * usuario está desactivado».
 */
export type Quien =
  | { ok: true; id: string; casilla: string }
  | { ok: false; respuesta: NextResponse };

export async function quienLlama(supabase: SupabaseClient): Promise<Quien> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, respuesta: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };

  const { data: usuario, error } = await supabase
    .from("usuarios")
    .select("activo, email")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      respuesta: NextResponse.json({ error: `No se pudo comprobar tu usuario: ${error.message}` }, { status: 503 }),
    };
  }
  if (!usuario?.activo) {
    return { ok: false, respuesta: NextResponse.json({ error: "Tu usuario está desactivado" }, { status: 403 }) };
  }

  const casilla = (usuario.email ?? user.email ?? "").trim().toLowerCase();
  if (!casilla) {
    return {
      ok: false,
      respuesta: NextResponse.json(
        { error: "Tu usuario no tiene un correo, y sin él no hay calendario donde escribir" },
        { status: 409 }
      ),
    };
  }
  return { ok: true, id: user.id, casilla };
}

export const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
