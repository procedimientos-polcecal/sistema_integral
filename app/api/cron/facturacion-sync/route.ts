import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { hayCredencialesOdoo } from "@/lib/odoo/client";
import { sincronizarFacturasConOdoo } from "@/lib/odoo/sincronizarFacturas";

export const maxDuration = 300;

/**
 * Cierra el círculo una vez por día: qué facturas del buzón ya están en Odoo.
 *
 * Corre después del de Compras a propósito. Compras empuja las órdenes; si una
 * factura se generó desde una orden creada esta misma mañana, conviene que la
 * orden exista antes de salir a buscar la factura.
 *
 * Falla cerrado: sin `CRON_SECRET` devuelve 503 en vez de quedar abierto a
 * cualquiera que conozca la URL.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  // Sin Odoo configurado no hay nada que conciliar, y no es un error.
  if (!hayCredencialesOdoo()) {
    return NextResponse.json({ omitido: "Odoo no está configurado" });
  }

  try {
    const resumen = await sincronizarFacturasConOdoo(createAdminClient());
    return NextResponse.json(resumen);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
