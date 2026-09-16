import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hayCredencialesOdoo, avisoDeCredencialesFaltantes } from "@/lib/odoo/client";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { puedeEditarCalidad } from "@/lib/calidad/auth";
import { sincronizarCarbonillaConOdoo } from "@/lib/calidad/sincronizar";

export const maxDuration = 300;

/**
 * El botón **Sincronizar ahora** de la pantalla del stock.
 *
 * Es el mismo trabajo que el cron de las cinco de la mañana. Existe porque el
 * cron corre una vez por día y un camión que se cargó en Odoo a media mañana no
 * puede esperar a la madrugada siguiente para aparecer en el stock.
 *
 * Usa el cliente admin para escribir, así que **el permiso se chequea acá**:
 * con el cliente admin RLS no corre.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para sincronizar" }, { status: 403 });
  }

  if (!hayCredencialesOdoo()) {
    return NextResponse.json({ error: avisoDeCredencialesFaltantes() }, { status: 400 });
  }

  try {
    const resumen = await sincronizarCarbonillaConOdoo(createAdminClient());
    await registrarSincronizacion({
      modulo: "calidad",
      recurso: "carbonilla-odoo",
      ok: true,
      filas: resumen.nuevas,
    });
    return NextResponse.json(resumen);
  } catch (e) {
    // Lo que dijo Odoo, sin traducir: es lo que hace que un diagnóstico se
    // distinga de otro.
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
