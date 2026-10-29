import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarProduccion } from "@/lib/produccion/auth";
import { sincronizarMolinos } from "@/lib/produccion/molinos/sincronizar";

export const maxDuration = 300;

/**
 * El botón: importar ahora los zips de los molinos, sin esperar al cron de las
 * 13:00 UTC. Hace exactamente lo mismo que el cron —comparten
 * `sincronizarMolinos`— y devuelve el detalle, avisos incluidos.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarProduccion(supabase, user.id))) {
    return NextResponse.json(
      { error: "Tu usuario no tiene nivel de edición en Producción" },
      { status: 403 }
    );
  }

  try {
    const r = await sincronizarMolinos(createAdminClient());
    // 200 aunque haya errores: la respuesta los lleva y la pantalla los muestra,
    // en vez de convertir un zip viejo en un "falló" sin explicación.
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
