import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { ponerAlDiaLosCanales } from "@/lib/agenda/canales";
import { reintentarLosPendientes } from "@/lib/agenda/reintentarPendientes";

// Catorce casillas con tres viajes a Google cada una, y después la cola de
// pendientes. La cola tiene su propio corte a los 240 s (`PRESUPUESTO_MS`).
export const maxDuration = 300;

/**
 * Agenda: abre y renueva los canales de Google, y reintenta lo que no pudo
 * escribirse (`GET`).
 *
 * **Corre a las 5 UTC, antes que todos los demás**, porque de esto depende que
 * el resto avise: si un canal venció, la Agenda deja de enterarse de lo que
 * pasa en Google y no hay nada que lo diga.
 *
 * Hace dos cosas, **cada una por su cuenta** —que falle la primera no salta la
 * segunda— y cada una se anota en `sincronizaciones` (módulo `agenda`):
 *
 *  1. `canales`: un canal vivo por usuario activo. **Un canal muerto no se
 *     distingue de uno sano**, así que lo que no se pueda abrir o renovar se
 *     registra como fallido **nombrando la casilla**. Un aviso que se apaga solo
 *     es peor que no tenerlo.
 *  2. `pendientes`: los `google_pendiente`. **Un evento divergido no se
 *     reintenta** (pisaría lo que una persona hizo en Google); ver
 *     `lib/agenda/reintentarPendientes.ts`.
 *
 * Los canales se registran con `NEXT_PUBLIC_APP_URL`: Google llama de afuera y
 * necesita el dominio completo. Ver `docs/VARIABLES-VERCEL.md`.
 *
 * Falla cerrado: sin `CRON_SECRET` devuelve 503.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  const supabase = createAdminClient();
  const respuesta: Record<string, unknown> = {};
  let huboError = false;

  try {
    const c = await ponerAlDiaLosCanales(supabase, process.env.NEXT_PUBLIC_APP_URL);
    await registrarSincronizacion({
      modulo: "agenda",
      recurso: "canales",
      ok: c.fallos.length === 0,
      filas: c.abiertos.length + c.renovados.length,
      error: c.fallos.length > 0 ? c.fallos.join(" · ").slice(0, 2000) : null,
    });
    respuesta.canales = c;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    huboError = true;
    await registrarSincronizacion({ modulo: "agenda", recurso: "canales", ok: false, error });
    respuesta.canales = { error };
  }

  try {
    const p = await reintentarLosPendientes(supabase);
    await registrarSincronizacion({
      modulo: "agenda",
      recurso: "pendientes",
      ok: p.fallos.length === 0,
      filas: p.limpiados,
      error: p.fallos.length > 0 ? p.fallos.join(" · ").slice(0, 2000) : null,
    });
    respuesta.pendientes = p;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    huboError = true;
    await registrarSincronizacion({ modulo: "agenda", recurso: "pendientes", ok: false, error });
    respuesta.pendientes = { error };
  }

  // 500 sólo si una de las dos no pudo ni empezar; los fallos por casilla o por
  // evento son un 200 con el detalle, igual que en las demás sincronizaciones.
  return NextResponse.json(respuesta, { status: huboError ? 500 : 200 });
}
