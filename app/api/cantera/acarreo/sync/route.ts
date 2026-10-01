import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tieneAccesoCantera } from "@/lib/cantera/auth";
import { sincronizarAcarreoDesdeSheets } from "@/lib/cantera/importarAcarreo";

/**
 * Traer "Datos" (la planilla de balanza) a demanda, disparado por una
 * persona desde el botón "Actualizar" de `/cantera/acarreo` — misma función
 * que corre el cron cada 20 minutos (`/api/cron/cantera-acarreo-sync`), acá
 * sin esperar al reloj. Alcanza con tener acceso al módulo: esto no escribe
 * nada propio, sólo copia lo que ya dice la planilla.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }

  try {
    const resultado = await sincronizarAcarreoDesdeSheets(true);
    return NextResponse.json(resultado);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
