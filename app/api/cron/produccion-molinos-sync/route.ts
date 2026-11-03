import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { sincronizarMolinos } from "@/lib/produccion/molinos/sincronizar";

export const maxDuration = 300;

/**
 * Una vez por día: traer de Drive el zip que dejó la tarea del PC Robot y
 * reconciliar los turnos de cada molino.
 *
 * A las 13:00 UTC —las 10 de Argentina—, media hora **después** de que la
 * tarea programada sube el zip (09:30 locales); antes no existe el archivo del
 * día. Y queda después del resumen diario de las 11:30 UTC: por eso este
 * frente no agrega avisos al resumen en la v1.
 *
 * La sincronización se anota en `sincronizaciones` **también cuando falla**
 * (lo hace `sincronizarMolinos`). Un zip viejo, uno que falta o uno que se
 * encogió dan 500, para que el cron de Vercel lo muestre como corrida fallida.
 *
 * Falla cerrado: sin `CRON_SECRET` devuelve 503.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  try {
    const r = await sincronizarMolinos(createAdminClient());
    return NextResponse.json(r, { status: r.ok ? 200 : 500 });
  } catch (e) {
    // `sincronizarMolinos` atrapa lo suyo; esto es lo que no previó.
    const error = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error }, { status: 500 });
  }
}
