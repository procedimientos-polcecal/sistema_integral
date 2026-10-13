import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { hayCredencialesOdoo } from "@/lib/odoo/client";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { leerLaPlanilla } from "@/lib/calidad/desdeLaPlanilla";
import { controlarContraOdoo } from "@/lib/calidad/sincronizar";

export const maxDuration = 300;

/**
 * Una vez por día: traer de la planilla lo que el libro no tiene, y después
 * controlar el libro contra Odoo.
 *
 * **El orden importa.** La lectura va primero porque es lo que mueve el stock;
 * el control va después para que mire el libro ya actualizado. Y si la lectura
 * falla, **el control no corre**: conciliar sobre un libro que quedó a medias
 * inventa desvíos que nadie va a poder explicar.
 *
 * Son dos marcas en `sincronizaciones` y no una, porque son dos cosas que
 * pueden fallar por separado: `carbonilla-planilla` cuenta los movimientos que
 * entraron, y `carbonilla-odoo` cuenta los camiones sin orden de compra — que
 * es lo que la tarjeta del tablero muestra sin tener que llamar a Odoo.
 *
 * A las 8 UTC —cinco de la mañana acá—, que es el hueco libre entre los cinco
 * crons que ya hay, y bastante antes de que alguien abra la pantalla.
 *
 * Falla cerrado: sin `CRON_SECRET` devuelve 503 en vez de quedar abierto a
 * cualquiera que conozca la URL.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  const admin = createAdminClient();

  // ── 1. La planilla, que es lo que mueve el stock ───────────
  let lectura;
  try {
    lectura = await leerLaPlanilla(admin);
    await registrarSincronizacion({
      modulo: "calidad",
      recurso: "carbonilla-planilla",
      ok: true,
      filas: lectura.nuevos,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    // Se anota también cuando falla: una fecha vieja sin explicación es
    // exactamente lo que hace que nadie sepa si está mirando datos al día.
    await registrarSincronizacion({
      modulo: "calidad",
      recurso: "carbonilla-planilla",
      ok: false,
      error,
    });
    return NextResponse.json({ error }, { status: 500 });
  }

  // ── 2. El control contra Odoo ──────────────────────────────
  // Sin Odoo configurado el stock no deja de funcionar: sólo no se controla.
  if (!hayCredencialesOdoo()) {
    return NextResponse.json({ lectura, control: "Odoo no está configurado" });
  }

  try {
    const control = await controlarContraOdoo(admin);
    await registrarSincronizacion({
      modulo: "calidad",
      recurso: "carbonilla-odoo",
      ok: true,
      filas: control.sinOrden.length,
    });
    return NextResponse.json({ lectura, control });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await registrarSincronizacion({
      modulo: "calidad",
      recurso: "carbonilla-odoo",
      ok: false,
      error,
    });
    // La lectura sí anduvo: el stock está al día aunque el control no se haya
    // podido hacer, y eso se dice en vez de devolver un 500 a secas.
    return NextResponse.json({ lectura, error }, { status: 200 });
  }
}
