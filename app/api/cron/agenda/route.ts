import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { ponerAlDiaLosCanales, barrerLasCasillas, resumenDelConteo, lineaDeLosEventosMirados } from "@/lib/agenda/canales";
import { reintentarLosPendientes } from "@/lib/agenda/reintentarPendientes";

export const maxDuration = 300;

/**
 * **Un solo presupuesto por corrida**, que se cuenta desde que arranca la función
 * y se le pasa a las **tres** fases: cada una deja de empezar trabajo al llegar.
 *
 * Por qué 200 s y no 280: un corte sólo se mira entre una llamada y la siguiente, y
 * una llamada a Google puede tardar hasta 30 s (`CORTE_MS` de `calendar.ts`). Abrir
 * o renovar un canal son hasta tres, así que una casilla empezada justo al límite
 * llega a 200 + 90 s. El margen que queda hasta los 300 s es para **registrar**: si
 * Vercel mata la función antes de que cada fase anote su fila en `sincronizaciones`,
 * el día que Google se cae —justo cuando hace falta— no queda ningún rastro y el
 * cartel sigue mostrando la corrida de ayer.
 */
const PRESUPUESTO_DE_LA_CORRIDA_MS = 200_000;

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

  const limite = Date.now() + PRESUPUESTO_DE_LA_CORRIDA_MS;
  const supabase = createAdminClient();
  const respuesta: Record<string, unknown> = {};
  let huboError = false;

  try {
    const c = await ponerAlDiaLosCanales(supabase, process.env.NEXT_PUBLIC_APP_URL, new Date(), limite);
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
    const b = await barrerLasCasillas(supabase, new Date(), limite);
    await registrarSincronizacion({
      modulo: "agenda",
      recurso: "barrido",
      ok: b.fallos.length === 0,
      // Los eventos que **miró**: es la señal de salud. «14 casillas, 0 eventos mirados»
      // es lo que se vería si el select de `revisarLaCasilla` no encontrara nada, y de
      // otro modo se vería idéntico a un día sano. Las divergencias anotadas son un
      // hallazgo y no un fallo, y van en la respuesta.
      filas: b.conteo.revisadas,
      // «3 divergencias detectadas, 0 anotadas» tiene que saltar a la vista el primer
      // día: si el update condicional no tocara nunca la fila, todo se vería verde y
      // la campana en cero. Ver `ConteoDeLaRevision`.
      error:
        [
          resumenDelConteo(b.conteo),
          lineaDeLosEventosMirados(b.casillas, b.conteo.revisadas),
          ...b.fallos,
        ].filter(Boolean).join(" · ").slice(0, 2000) || null,
    });
    respuesta.barrido = b;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    huboError = true;
    await registrarSincronizacion({ modulo: "agenda", recurso: "barrido", ok: false, error });
    respuesta.barrido = { error };
  }

  try {
    const p = await reintentarLosPendientes(supabase, new Date(), limite);
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
