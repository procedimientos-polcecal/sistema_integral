import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { hayCredencialesOdoo } from "@/lib/odoo/client";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { sincronizarCarbonillaConOdoo } from "@/lib/calidad/sincronizar";

export const maxDuration = 300;

/**
 * Trae una vez por día las entradas de carbonilla que se cargaron en Odoo.
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

  // Sin Odoo configurado no hay nada que traer, y no es un error.
  if (!hayCredencialesOdoo()) {
    return NextResponse.json({ omitido: "Odoo no está configurado" });
  }

  try {
    const resumen = await sincronizarCarbonillaConOdoo(createAdminClient());
    // Se anota también cuando falla: una fecha vieja sin explicación es
    // exactamente lo que hace que nadie sepa si está mirando datos al día.
    await registrarSincronizacion({
      modulo: "calidad",
      recurso: "carbonilla-odoo",
      ok: true,
      filas: resumen.nuevas,
    });
    return NextResponse.json(resumen);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await registrarSincronizacion({
      modulo: "calidad",
      recurso: "carbonilla-odoo",
      ok: false,
      error,
    });
    return NextResponse.json({ error }, { status: 500 });
  }
}
