import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tieneAccesoTallerVial } from "@/lib/tallerVial/auth";
import { sincronizarTallerVialDesdeSheets } from "@/lib/tallerVial/importar";

/**
 * Traer de la planilla las cargas de combustible y los estados a demanda,
 * disparado desde el botón "Actualizar" de `/taller-vial/cargas` — misma
 * función que corre el cron (`/api/cron/taller-vial-sync`), sin esperar al
 * reloj. Mismo criterio que `/api/cantera/acarreo/sync`: alcanza con tener
 * acceso al módulo, porque sólo copia lo que ya dice la planilla.
 */
export const maxDuration = 60;

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoTallerVial(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Taller Vial" }, { status: 403 });
  }

  try {
    const { cargas, estados } = await sincronizarTallerVialDesdeSheets();
    return NextResponse.json({ cargas, estados: { ...estados, codigosSinMapear: [...estados.codigosSinMapear] } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
