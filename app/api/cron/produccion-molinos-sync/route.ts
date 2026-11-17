import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { sincronizarMolinos } from "@/lib/produccion/molinos/sincronizar";

export const maxDuration = 300;

/**
 * Una vez por día: traer de Drive el zip que dejó la tarea del PC Robot y
 * reconciliar los turnos de cada molino.
 *
 * **A las 10:00 UTC — las 7 de Argentina**, y la hora es la última pieza de
 * una cadena de tres que se movió entera el 12/11/2026, a pedido. Antes era
 * 13:00 UTC, media hora después de una subida que ocurría a las 09:30:
 *
 *   21:00 de Argentina   el robot genera el export del día
 *   22:00                la tarea del PC Robot lo sube a Drive
 *   07:00 (10:00 UTC)    esta corrida lo importa, nueve horas después
 *
 * Lo que hay que mirar al tocar **cualquiera** de las tres es que esta corrida
 * quede después de la subida y antes de que alguien abra la pantalla a la
 * mañana. Adelantarla sin mover las otras dos no rompe nada y ésa es la
 * trampa: importaría el zip de **anteayer** y `estaObsoleto` no lo diría,
 * porque mide 24 horas contra el `modifiedTime` de Drive —la subida— y no
 * contra la hora del export del robot, que es lo que de verdad envejece.
 *
 * Y una consecuencia que antes no existía: esto **ya no corre después del
 * resumen diario** de las 11:30 UTC, sino hora y media antes. No cambia nada
 * hoy porque este frente no agrega avisos al resumen, pero el día que agregue
 * uno, el resumen de esa misma mañana ya lo va a ver — que es mejor, y es
 * gratis.
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
