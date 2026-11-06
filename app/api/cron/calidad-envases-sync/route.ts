import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { sincronizarEnvases } from "@/lib/calidad/envases/sincronizar";

export const maxDuration = 300;

/**
 * Traer de la planilla de envases, sola.
 *
 * ── POR QUÉ ESTO NO EXISTÍA Y POR QUÉ HACÍA FALTA ───────────────────────
 *
 * Envases era el **único** de los cinco espejos sin corrida automática: su
 * única entrada era el botón de `/api/calidad/envases/sync`, que exige usuario
 * logueado. O sea que el stock del módulo sólo estaba al día si alguien se
 * acordaba de apretarlo.
 *
 * No se acordaban. Medido el 19/10/2026: la última sincronización había sido el
 * **14/10 a las 11:04**, el último movimiento que el SdG tenía era del **10/10**
 * y la planilla ya llevaba **18 movimientos de los cinco días siguientes**. En
 * Envases **manda la planilla**, así que durante cinco días el stock del SdG
 * estuvo mal —10 de 25 artículos— sin que nada lo dijera.
 *
 * Lo encontró el ensayo de la bajada de la planilla, al comparar lo que tiene
 * el SdG contra lo que tiene la planilla. Es justo la clase de divergencia que
 * un espejo sin corrida automática produce en silencio: nadie mira un número
 * que no cambió.
 *
 * ── LO QUE NO HACE ──────────────────────────────────────────────────────
 *
 * **No borra.** El borrado de espejo del 18/10 es sólo para las cuatro
 * planillas que espejan por número —OT, avisos, órdenes de servicio y los
 * requerimientos de Compras—, y ésta no es una de ellas: acá la ausencia de una
 * fila no prueba nada, porque el kardex se lee por contenido y no por número de
 * fila.
 *
 * Falla cerrado: sin `CRON_SECRET` devuelve 503 en vez de quedar abierto.
 *
 * `sincronizarEnvases()` ya deja sus dos marcas en `sincronizaciones`
 * —`envases_articulos` y `envases_movimientos`—, así que acá no se registra de
 * nuevo: serían dos filas diciendo lo mismo.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  const r = await sincronizarEnvases();
  return r.ok
    ? NextResponse.json(r.datos)
    : NextResponse.json({ error: r.error, ...(r.datos ?? {}) }, { status: r.status });
}
