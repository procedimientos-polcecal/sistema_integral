import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { ponerAlDiaLosCanales, barrerLasCasillas } from "@/lib/agenda/canales";
import { reintentarLosPendientes } from "@/lib/agenda/reintentarPendientes";

// Tres cosas con Google, una detrás de otra. Los cortes propios (el barrido a
// los 120 s, los pendientes a lo que quede de `LIMITE_TOTAL_MS`) anotan antes de
// que Vercel mate la función.
export const maxDuration = 300;

/** Lo que se le deja a la función antes de que Vercel la mate, para anotar. */
const LIMITE_TOTAL_MS = 280_000;

/**
 * Agenda: abre y renueva los canales de Google, barre todas las casillas y
 * reintenta lo que no pudo escribirse (`GET`).
 *
 * **Corre a las 5 UTC, antes que todos los demás**, porque de esto depende que
 * el resto avise: si un canal venció, la Agenda deja de enterarse de lo que
 * pasa en Google y no hay nada que lo diga.
 *
 * Hace tres cosas, **cada una por su cuenta** —que falle una no salta las
 * otras— y cada una se anota en `sincronizaciones` (módulo `agenda`):
 *
 *  1. `canales`: un canal vivo por usuario activo. **Un canal muerto no se
 *     distingue de uno sano**, así que lo que no se pueda abrir o renovar se
 *     registra como fallido **nombrando la casilla**. Un aviso que se apaga solo
 *     es peor que no tenerlo.
 *  2. `barrido`: `revisarLaCasilla` para todas las casillas, como si cada una
 *     hubiera avisado. **El webhook es el movimiento y el barrido es la red**: un
 *     canal recién abierto o vencido no vio lo que pasó mientras no estaba, y
 *     sin esto ese cambio no se detectaría nunca más. Es la misma idea del
 *     resumen diario de avisos, que los lunes manda los totales. Escribe la
 *     divergencia igual que el webhook. **Va antes que los pendientes** a
 *     propósito: un evento que el barrido encuentra divergido ya no se reintenta
 *     en esta misma corrida.
 *  3. `pendientes`: los `google_pendiente`. **Un evento divergido no se
 *     reintenta** (pisaría lo que una persona hizo en Google); ver
 *     `lib/agenda/reintentarPendientes.ts`.
 *
 * **`aviso` no se levanta nunca.** Un borrado que Google rechazó —el de una OT
 * que salió de la planilla, o el de una persona desde la Agenda— se anota en
 * `aviso` y no en `google_pendiente`, justamente para que ningún paso de acá lo
 * lea como «falta escribir» y resucite, o le mande una modificación a los
 * invitados de, un evento que se quería borrar. Este cron no lee esa columna.
 *
 * Los canales se registran con `NEXT_PUBLIC_APP_URL`: Google llama de afuera y
 * necesita el dominio completo. Ver `docs/VARIABLES-VERCEL.md`.
 *
 * Falla cerrado: sin `CRON_SECRET` devuelve 503.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  const empezo = Date.now();
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
    const b = await barrerLasCasillas(supabase);
    await registrarSincronizacion({
      modulo: "agenda",
      recurso: "barrido",
      ok: b.fallos.length === 0,
      // Las divergencias nuevas que encontró: son un hallazgo y no un fallo.
      filas: b.divergencias.length,
      error: b.fallos.length > 0 ? b.fallos.join(" · ").slice(0, 2000) : null,
    });
    respuesta.barrido = b;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    huboError = true;
    await registrarSincronizacion({ modulo: "agenda", recurso: "barrido", ok: false, error });
    respuesta.barrido = { error };
  }

  try {
    const p = await reintentarLosPendientes(
      supabase,
      new Date(),
      Math.min(240_000, LIMITE_TOTAL_MS - (Date.now() - empezo))
    );
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

  // 500 sólo si una de las tres no pudo ni empezar; los fallos por casilla o por
  // evento son un 200 con el detalle, igual que en las demás sincronizaciones.
  return NextResponse.json(respuesta, { status: huboError ? 500 : 200 });
}
