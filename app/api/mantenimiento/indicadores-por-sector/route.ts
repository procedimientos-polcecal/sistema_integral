import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeVerMantenimiento } from "@/lib/mantenimiento/auth";
import { hoyISO } from "@/lib/mantenimiento/alertas";
import { indicadoresPorSectorDeLaPlanta } from "@/lib/mantenimiento/porSectorDatos";

/**
 * MTBF, MTTR, MTTF y confiabilidad de cada sector, su evolución mensual y sus
 * paradas. Sin parámetros: la ventana y el «hoy» los decide el servidor.
 *
 * **La pide el tablero desde el cliente, después del primer pintado.** Es la
 * misma decisión que `/api/mantenimiento/mtbf`: esto necesita las ~2.500
 * órdenes de la ventana y el tablero se limpió a propósito de traer miles de
 * filas para contarlas en memoria. Así el resto pinta completo y rápido, y
 * esto llega después; si falla, no tumba la pantalla de entrada del módulo.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeVerMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Mantenimiento" }, { status: 403 });
  }

  try {
    return NextResponse.json(await indicadoresPorSectorDeLaPlanta(supabase, hoyISO()));
  } catch (e) {
    // El detalle va al log del servidor y no al cuerpo de la respuesta: lo que
    // falla acá es una lectura de `ordenes_trabajo`, y el mensaje de Supabase
    // nombra tablas y columnas. No se pierde —queda entero en los logs de
    // Vercel— y al tablero no le servía: ya muestra su propio renglón con el
    // botón de reintentar sin leer el cuerpo.
    console.error("[mantenimiento/indicadores-por-sector] no se pudo calcular:", e);
    return NextResponse.json(
      { error: "No se pudieron calcular los indicadores por sector. Probá de nuevo en un momento." },
      { status: 500 }
    );
  }
}
