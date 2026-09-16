import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCalidad } from "@/lib/calidad/auth";
import { efectoEnElSaldo } from "@/lib/calidad/movimientos";
import { exportarMovimiento, marcarPosterioresDesactualizados } from "@/lib/calidad/espejo";
import type { Movimiento } from "@/lib/calidad/types";

/**
 * Corregir un movimiento, y reintentar su escritura en la planilla.
 *
 * **Una corrección mueve el saldo de todo lo que vino después**, y la planilla
 * lleva ese saldo en tres columnas. No se reescriben cientos de filas contra
 * Google por una corrección: se marcan como desactualizadas y se ven. Una
 * divergencia conocida y visible es lo contrario de la que tiene hoy la
 * planilla.
 */

interface CuerpoDeLaCorreccion {
  fecha?: string;
  toneladas?: number;
  motivo?: string | null;
  /** Sin cambios: sólo reintentar la escritura en la planilla. */
  soloReintentar?: boolean;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para corregir movimientos" }, { status: 403 });
  }

  const { data: actual } = await supabase
    .from("calidad_movimientos")
    .select("id, fecha, tipo, carbon, toneladas, motivo, origen")
    .eq("id", id)
    .maybeSingle<Pick<Movimiento, "id" | "fecha" | "tipo" | "carbon" | "toneladas" | "motivo" | "origen">>();
  if (!actual) return NextResponse.json({ error: "No existe ese movimiento" }, { status: 404 });

  const cuerpo = await cuerpoJson<CuerpoDeLaCorreccion>(request);

  // Reintentar es el caso del botón que aparece al lado de un `sheets_pendiente`.
  if (cuerpo.soloReintentar) {
    const { aviso } = await exportarMovimiento(supabase, id);
    return NextResponse.json({ id, aviso });
  }

  const cambios: Record<string, unknown> = {
    actualizado_por: user.id,
    actualizado_en: new Date().toISOString(),
  };

  if (cuerpo.toneladas !== undefined) {
    const efecto = efectoEnElSaldo(actual.tipo, Math.abs(Number(cuerpo.toneladas)));
    if (efecto.problema) return NextResponse.json({ error: efecto.problema }, { status: 400 });
    // En un ajuste el signo es del dato, no una magnitud: se respeta el que vino.
    cambios.toneladas =
      actual.tipo === "ajuste" ? Math.round(Number(cuerpo.toneladas) * 1000) / 1000 : efecto.toneladas;
  }

  if (cuerpo.fecha !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cuerpo.fecha)) {
      return NextResponse.json({ error: "La fecha no tiene la forma AAAA-MM-DD." }, { status: 400 });
    }
    cambios.fecha = cuerpo.fecha;
  }

  if (cuerpo.motivo !== undefined) {
    const motivo = (cuerpo.motivo ?? "").trim();
    if (actual.tipo === "ajuste" && !motivo) {
      return NextResponse.json({ error: "Un ajuste no se queda sin motivo." }, { status: 400 });
    }
    cambios.motivo = actual.tipo === "ajuste" ? motivo : null;
  }

  const { error } = await supabase.from("calidad_movimientos").update(cambios).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Desde la más vieja de las dos fechas: si el movimiento se movió hacia atrás,
  // lo que quedó mal empieza en la fecha nueva.
  const desde =
    typeof cambios.fecha === "string" && cambios.fecha < actual.fecha
      ? (cambios.fecha as string)
      : actual.fecha;
  await marcarPosterioresDesactualizados(supabase, desde);

  const { aviso } = await exportarMovimiento(supabase, id);
  return NextResponse.json({ id, aviso });
}
