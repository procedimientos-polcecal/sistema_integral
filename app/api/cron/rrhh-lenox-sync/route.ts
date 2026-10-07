import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { hayCredencialesLenox } from "@/lib/rrhh/lenox/cliente";
import { correrSincronizacion } from "@/lib/rrhh/lenox/corrida";
import { ventanaDelCron } from "@/lib/rrhh/lenox/rango";
import { utcDateOnlyFrom } from "@/lib/rrhh/dates";

export const maxDuration = 300;

/**
 * Trae una vez por día las marcaciones del reloj.
 *
 * A las 10:30 UTC —7:30 de acá—, que no es arbitrario: después de que cierre
 * el turno noche (termina alrededor de las 4) y antes de que alguien abra la
 * pantalla. Es además el hueco que queda entre los ocho crons que ya hay,
 * amontonados entre las 6 y las 9:30 UTC.
 *
 * La ventana es de 7 días contando hoy, que es también el tope por pedido de
 * la API: una sola llamada de marcaciones. El riesgo asumido está en el spec —
 * si nadie mira durante más de una semana, lo más viejo que 7 días hay que
 * traerlo con el botón.
 *
 * Falla cerrado: sin `CRON_SECRET` devuelve 503 en vez de quedar abierto a
 * cualquiera que conozca la URL.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  // Sin la clave no hay nada que traer, y no es un error.
  if (!hayCredencialesLenox()) {
    return NextResponse.json({ omitido: "Lenox no está configurado" });
  }

  // A las 10:30 UTC el día UTC y el de Argentina son el mismo, así que acá no
  // hace falta `fechaArgentinaDe`.
  const { desde, hasta } = ventanaDelCron(utcDateOnlyFrom(new Date()));

  // usuarioId null: lo corrió el cron, no una persona.
  const corrida = await correrSincronizacion(desde, hasta, null);
  if (corrida.ok) return NextResponse.json(corrida.resumen);

  return NextResponse.json(
    { error: corrida.error },
    { status: corrida.excesoDeLlamadas ? 429 : 500 }
  );
}
