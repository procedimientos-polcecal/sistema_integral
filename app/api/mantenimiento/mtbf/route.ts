import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeVerMantenimiento } from "@/lib/mantenimiento/auth";
import { hoyISO } from "@/lib/mantenimiento/alertas";
import { mtbfDeLaPlanta } from "@/lib/mantenimiento/mtbfDatos";

/**
 * Cada cuánto falla cada equipo, y qué tan probable es que aguante 7 y 30 días.
 * Sin parámetros: la ventana y el "hoy" los decide el servidor.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeVerMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Mantenimiento" }, { status: 403 });
  }

  try {
    return NextResponse.json(await mtbfDeLaPlanta(supabase, hoyISO()));
  } catch (e) {
    // El detalle va al log del servidor y no al cuerpo de la respuesta: lo que
    // falla acá es una lectura de `ordenes_trabajo`, y el mensaje de Supabase
    // nombra tablas y columnas. No se pierde —queda entero en los logs de
    // Vercel, que es donde se diagnostica—, y al tablero no le servía: ya
    // muestra su propio renglón con el botón de reintentar sin leer el cuerpo.
    console.error("[mantenimiento/mtbf] no se pudo calcular el MTBF:", e);
    return NextResponse.json(
      { error: "No se pudo calcular el MTBF. Probá de nuevo en un momento." },
      { status: 500 }
    );
  }
}
