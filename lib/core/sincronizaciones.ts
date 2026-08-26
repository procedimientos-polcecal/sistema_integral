import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Deja anotado que un recurso se sincronizó con su planilla.
 *
 * Se registra **también cuando falla**, y eso es el punto: una fecha vieja sin
 * explicación es justo lo que hace que nadie sepa si está mirando datos al día.
 * Si sólo se anotaran los éxitos, una sincronización rota se vería igual que
 * una que nunca corrió.
 *
 * Nunca lanza. Es un dato para la pantalla, no parte de la operación: que no se
 * pueda anotar no puede hacer fallar la sincronización que sí funcionó.
 */
export async function registrarSincronizacion(datos: {
  modulo: string;
  recurso: string;
  ok: boolean;
  error?: string | null;
  filas?: number;
}): Promise<void> {
  try {
    await createAdminClient().from("sincronizaciones").insert({
      modulo: datos.modulo,
      recurso: datos.recurso,
      ok: datos.ok,
      error: datos.error ?? null,
      filas: datos.filas ?? 0,
    });
  } catch (e) {
    console.error("No se pudo registrar la sincronización:", e);
  }
}

/** La última corrida de cada recurso, como la deja la vista. */
export interface UltimaSync {
  modulo: string;
  recurso: string;
  ok: boolean;
  error: string | null;
  created_at: string;
}

/**
 * Cuándo se actualizó por última vez un recurso.
 *
 * Sale de la vista `ultima_sincronizacion`, que une la tabla de Compras con la
 * genérica: la pantalla no tiene que saber de qué módulo viene el dato ni en
 * qué tabla se guarda.
 *
 * Devuelve null si nunca corrió, y también si la consulta falla: el cartel dice
 * "sin sincronizar todavía", que es preferible a voltear la pantalla por un
 * dato accesorio.
 */
export async function ultimaSincronizacionDe(
  supabase: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  modulo: string,
  recurso: string
): Promise<UltimaSync | null> {
  try {
    const { data } = await supabase
      .from("ultima_sincronizacion")
      .select("modulo, recurso, ok, error, created_at")
      .eq("modulo", modulo)
      .eq("recurso", recurso)
      .maybeSingle();
    return (data as UltimaSync) ?? null;
  } catch {
    return null;
  }
}
