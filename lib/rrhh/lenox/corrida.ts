import { createAdminClient } from "@/lib/supabase/admin";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { sincronizarMarcaciones, type ResumenSincronizacion } from "./sincronizar";
import { esExcesoDeLlamadas } from "./errores";

export type Corrida =
  | { ok: true; resumen: ResumenSincronizacion }
  | { ok: false; error: string; excesoDeLlamadas: boolean };

/**
 * Una corrida completa: sincronizar y dejarla anotada. La comparten el cron y
 * el botón, que sólo difieren en quién la dispara y cómo contestan.
 *
 * Se anota **también cuando falla**, con el texto que dio Lenox sin traducir:
 * una fecha vieja sin explicación es justo lo que hace que nadie sepa si está
 * mirando datos al día.
 *
 * Nunca lanza. Un fallo vuelve como valor para que cada ruta decida el status
 * sin tener que atrapar nada.
 *
 * `ok: true` también cuando el resumen trae avisos o pendientes: son cosas que
 * alguien tiene que mirar, no una corrida que falló. Mezclarlos haría que un
 * día con una fichada abierta se vea igual que un día con Lenox caído.
 */
export async function correrSincronizacion(
  desde: Date,
  hasta: Date,
  usuarioId: string | null
): Promise<Corrida> {
  try {
    const resumen = await sincronizarMarcaciones(createAdminClient(), desde, hasta, usuarioId);
    await registrarSincronizacion({
      modulo: "rrhh",
      recurso: "lenox-marcaciones",
      ok: true,
      filas: resumen.insertados,
    });
    return { ok: true, resumen };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await registrarSincronizacion({
      modulo: "rrhh",
      recurso: "lenox-marcaciones",
      ok: false,
      error,
    });
    return { ok: false, error, excesoDeLlamadas: esExcesoDeLlamadas(e) };
  }
}
