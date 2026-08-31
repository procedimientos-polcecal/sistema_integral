import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { recalcularVentana } from "@/lib/rrhh/recalculoProgramado";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";

export const maxDuration = 300;

/**
 * Deja `calculos_diarios` al día para todo el padrón.
 *
 * Antes esto lo hacía cada pantalla antes de leer, y salía carísimo: abrir el
 * Dashboard disparaba hasta cinco recálculos del padrón entero —uno por
 * endpoint, porque el cache vivía en la memoria del proceso y en serverless
 * cada request cae en una instancia distinta— y el Analítico hacía seis, uno
 * por mes, en serie.
 *
 * Ahora las pantallas sólo leen. Lo que mantiene los números frescos son tres
 * cosas: cada guardado recalcula lo suyo (una fichada, una ausencia, un período
 * de vacaciones), los cambios que afectan a todos disparan la ventana, y esta
 * corrida cubre lo único que ninguna de las dos ve: que pase el tiempo.
 *
 * Falla cerrado: sin CRON_SECRET configurado devuelve 503.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  try {
    // Cliente admin a propósito: lo llama un reloj, no una persona, así que no
    // hay sesión y RLS dejaría el padrón vacío.
    const resultado = await recalcularVentana(createAdminClient());
    await registrarSincronizacion({
      modulo: "rrhh",
      recurso: "recalculo",
      ok: true,
      filas: resultado.empleados,
    });
    return NextResponse.json(resultado);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await registrarSincronizacion({ modulo: "rrhh", recurso: "recalculo", ok: false, error });
    return NextResponse.json({ error }, { status: 500 });
  }
}
