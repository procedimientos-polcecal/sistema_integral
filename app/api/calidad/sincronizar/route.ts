import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hayCredencialesOdoo, avisoDeCredencialesFaltantes } from "@/lib/odoo/client";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { usuarioActual } from "@/lib/core/sesion";
import { puedeEditarCalidad } from "@/lib/calidad/auth";
import { leerLaPlanilla } from "@/lib/calidad/desdeLaPlanilla";
import { controlarContraOdoo } from "@/lib/calidad/sincronizar";

export const maxDuration = 300;

/**
 * El botón **Sincronizar ahora** de la pantalla del stock.
 *
 * Es el mismo trabajo que el cron de las cinco de la mañana: traer de la
 * planilla lo que el libro no tiene, y después controlar el libro contra Odoo.
 * Existe porque el cron corre una vez por día, y un consumo anotado a media
 * mañana no puede esperar a la madrugada siguiente para verse en el stock.
 *
 * **El orden importa y la lectura no depende de Odoo.** Si Odoo está caído o
 * sin configurar, el stock se actualiza igual y sólo se omite el control — al
 * revés de como estaba antes del 13/10/2026, cuando sin Odoo no había nada que
 * traer porque Odoo era la fuente.
 *
 * Usa el cliente admin para escribir, así que **el permiso se chequea acá**:
 * con el cliente admin RLS no corre.
 */
export async function POST() {
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para sincronizar" }, { status: 403 });
  }

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
    await registrarSincronizacion({
      modulo: "calidad",
      recurso: "carbonilla-planilla",
      ok: false,
      error,
    });
    return NextResponse.json({ error }, { status: 500 });
  }

  // ── 2. El control contra Odoo ──────────────────────────────
  // Que falte Odoo no es un error del stock: se dice y se sigue.
  if (!hayCredencialesOdoo()) {
    return NextResponse.json({ lectura, aviso: avisoDeCredencialesFaltantes() });
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
    // Lo que dijo Odoo, sin traducir: es lo que hace que un diagnóstico se
    // distinga de otro. El stock sí quedó al día, y eso se dice.
    const error = e instanceof Error ? e.message : String(e);
    await registrarSincronizacion({
      modulo: "calidad",
      recurso: "carbonilla-odoo",
      ok: false,
      error,
    });
    return NextResponse.json({ lectura, aviso: `El stock se actualizó. Odoo no contestó: ${error}` });
  }
}
