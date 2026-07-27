import type { SupabaseClient } from "@supabase/supabase-js";
import { recalcularSectorPeriodo } from "./engine/recalcular";

/**
 * Cache para los recálculos de SOLO LECTURA (dashboard y analítico), que sin
 * esto recalculan el período entero de todo el personal en cada carga. Cada
 * instancia serverless mantiene su propio cache: en el peor caso hay un
 * cache-miss de más (recalcular es idempotente), nunca un dato incorrecto.
 */
const RECALC_TTL_MS = 90_000; // 90 s
const ultimoRecalc = new Map<string, number>();
const enCurso = new Map<string, Promise<void>>();

async function recalcularConCache(clave: string, fn: () => Promise<void>): Promise<void> {
  const ahora = Date.now();
  if (ahora - (ultimoRecalc.get(clave) ?? 0) < RECALC_TTL_MS) return;

  const yaEnCurso = enCurso.get(clave);
  if (yaEnCurso) return yaEnCurso;

  const promesa = (async () => {
    try {
      await fn();
      ultimoRecalc.set(clave, Date.now());
    } finally {
      enCurso.delete(clave);
    }
  })();
  enCurso.set(clave, promesa);
  return promesa;
}

/** Recalcula todo el personal activo para el período dado, cacheado por rango. */
export async function recalcularPeriodoCacheado(supabase: SupabaseClient, desde: Date, hasta: Date): Promise<void> {
  const clave = `${desde.getTime()}:${hasta.getTime()}`;
  await recalcularConCache(clave, async () => {
    await recalcularSectorPeriodo(supabase, null, desde, hasta);
  });
}
