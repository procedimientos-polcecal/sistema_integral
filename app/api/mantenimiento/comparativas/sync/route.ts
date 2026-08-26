import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { leerValores } from "@/lib/core/sheets";
import { COMPARATIVA_PESTANAS, filaDeComparativa } from "@/lib/mantenimiento/comparativas";
import { cargarEnlaces, resolver, proveedorDe } from "@/lib/mantenimiento/enlaces";

export const maxDuration = 300;

/**
 * Trae las comparativas de proveedores de su planilla.
 *
 * La planilla manda: acá es un espejo. Cada pestaña es un sector y cada fila
 * una cotización; varias filas con el mismo N° de OS son las ofertas que se
 * compararon para ese servicio.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sincronizar las comparativas requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const planilla = process.env.GOOGLE_SHEETS_COMPARATIVAS_ID ?? "";
  if (!planilla) {
    return NextResponse.json(
      { error: "Falta configurar GOOGLE_SHEETS_COMPARATIVAS_ID" },
      { status: 503 }
    );
  }

  const admin = createAdminClient();
  const enlaces = await cargarEnlaces(admin);

  const cotizaciones: Record<string, unknown>[] = [];
  const sinLeer: string[] = [];
  const sinProveedor = new Set<string>();
  const cuando = new Date().toISOString();

  for (const pestana of COMPARATIVA_PESTANAS) {
    let filas: string[][];
    try {
      filas = await leerValores(planilla, pestana, { sinFormato: true });
    } catch {
      // Una pestaña que se renombró o se borró no puede frenar a las otras
      // once, pero tiene que verse en el resultado.
      sinLeer.push(pestana);
      continue;
    }

    for (let i = 1; i < filas.length; i++) {
      const cot = filaDeComparativa(filas[i], i + 1, pestana);
      if (!cot) continue;

      const proveedor_id = proveedorDe(enlaces, cot.proveedor);
      if (!proveedor_id) sinProveedor.add(cot.proveedor);

      // La cotización dice de qué máquina es: sirve para ver lo que se cotizó
      // de un equipo sin pasar por la OS.
      const { equipment_id } = resolver(enlaces, cot);

      cotizaciones.push({ ...cot, proveedor_id, equipment_id, synced_at: cuando });
    }
  }

  // Sin nada leído no se toca el espejo: una planilla inaccesible lo borraría
  // entero y no habría con qué volver a armarlo.
  if (cotizaciones.length === 0) {
    return NextResponse.json(
      {
        error:
          sinLeer.length === COMPARATIVA_PESTANAS.length
            ? "No se pudo leer ninguna pestaña de la planilla."
            : "La planilla no tiene ninguna cotización cargada.",
        sin_leer: sinLeer,
      },
      { status: 502 }
    );
  }

  // Refresco completo: en la planilla se corrigen y se borran filas, y sólo
  // volviendo a leerla entera queda igual de los dos lados.
  const { error: errorBorrado } = await admin
    .from("os_comparativas")
    .delete()
    .not("id", "is", null);
  if (errorBorrado) {
    return NextResponse.json({ error: errorBorrado.message }, { status: 400 });
  }

  let guardadas = 0;
  for (let i = 0; i < cotizaciones.length; i += 500) {
    const lote = cotizaciones.slice(i, i + 500);
    const { error } = await admin.from("os_comparativas").insert(lote);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    guardadas += lote.length;
  }

  const ordenes = new Set(cotizaciones.map((c) => c.os_number)).size;
  return NextResponse.json({
    guardadas, ordenes, sin_leer: sinLeer, sin_proveedor: [...sinProveedor],
  });
}
