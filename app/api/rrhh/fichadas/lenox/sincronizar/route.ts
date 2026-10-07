import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/rrhh/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { hayCredencialesLenox } from "@/lib/rrhh/lenox/cliente";
import { correrSincronizacion } from "@/lib/rrhh/lenox/corrida";
import { problemaDelRango } from "@/lib/rrhh/lenox/rango";

export const maxDuration = 300;

/** Cuánto hay que esperar tras un 429, en segundos: lo que dice el mensaje del cliente. */
const ESPERA_TRAS_429_SEGUNDOS = 15 * 60;

// `z.iso.date()` y no un regex: además de la forma rechaza el 30 de febrero,
// que con un regex pasaría y `Date.UTC` lo correría en silencio al 2 de marzo.
const esquema = z.object({
  desde: z.iso.date(),
  hasta: z.iso.date(),
});

/**
 * El botón "Traer de Lenox": sincroniza un rango a pedido.
 *
 * Contesta distinto según qué pasó, porque la pantalla tiene que poder tratarlos
 * distinto:
 * - 200 con el resumen entero —`insertados`, `reemplazados`, `salteados`,
 *   `avisos`, `pendientes`—: se sincronizó. Que traiga avisos no lo vuelve un
 *   error, y el resumen va completo para que la pantalla los muestre.
 * - 429: Lenox rechazó por exceso de llamadas. No es un error nuestro y se
 *   resuelve esperando; con `Retry-After` para que la pantalla pueda decirlo.
 * - 503: falta `LENOX_API_KEY`.
 * - 500: se intentó y falló por otra cosa, con lo que dijo Lenox sin traducir.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;
  const { data: { user } } = await supabase.auth.getUser();

  if (!hayCredencialesLenox()) {
    return NextResponse.json({ error: "Lenox no está configurado (falta LENOX_API_KEY)" }, { status: 503 });
  }

  const resultado = validar(esquema, await cuerpoJson(request));
  if (!resultado.ok) return errorDeValidacion(resultado.problemas);

  // Un día calendario es medianoche UTC (convención de `lib/rrhh/dates.ts`), y
  // `z.iso.date` ya garantizó que la fecha existe.
  const desde = new Date(`${resultado.datos.desde}T00:00:00.000Z`);
  const hasta = new Date(`${resultado.datos.hasta}T00:00:00.000Z`);
  const problema = problemaDelRango(desde, hasta);
  if (problema) return NextResponse.json({ error: problema }, { status: 400 });

  const corrida = await correrSincronizacion(desde, hasta, user?.id ?? null);
  if (corrida.ok) return NextResponse.json(corrida.resumen);

  if (corrida.excesoDeLlamadas) {
    return NextResponse.json(
      { error: corrida.error },
      { status: 429, headers: { "Retry-After": String(ESPERA_TRAS_429_SEGUNDOS) } }
    );
  }
  return NextResponse.json({ error: corrida.error }, { status: 500 });
}
