import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarFacturacion } from "@/lib/facturacion/auth";
import {
  avisoDeCredencialesFaltantes,
  dondeApuntaOdoo,
  hayCredencialesOdoo,
} from "@/lib/odoo/client";
import { sincronizarFacturasConOdoo } from "@/lib/odoo/sincronizarFacturas";

export const maxDuration = 300;

/**
 * La misma sincronización que el cron, pero a pedido.
 *
 * Hace falta porque el cron corre una vez por día y el plan de Vercel no admite
 * más: cuando administración acaba de cargar un lote en Odoo, esperar hasta
 * mañana para ver el buzón limpio es esperar de más.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarFacturacion(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sincronizar con Odoo requiere nivel de edición en Facturación" },
      { status: 403 }
    );
  }

  if (!hayCredencialesOdoo()) {
    return NextResponse.json({ error: avisoDeCredencialesFaltantes() }, { status: 503 });
  }

  try {
    const resumen = await sincronizarFacturasConOdoo(createAdminClient());
    return NextResponse.json({ ...resumen, odoo: dondeApuntaOdoo() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
