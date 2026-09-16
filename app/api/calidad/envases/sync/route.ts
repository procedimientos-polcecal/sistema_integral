import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tieneAccesoCalidad } from "@/lib/calidad/auth";
import { sincronizarEnvases } from "@/lib/calidad/envases/sincronizar";

/**
 * Traer de la planilla de envases.
 *
 * Es la misma función que corre la carga inicial: la primera vez trae los
 * artículos y el kardex entero, y de ahí en adelante refresca.
 *
 * Alcanza con tener acceso al módulo: traer de la planilla no cambia lo que la
 * planilla dice —sólo lo copia— así que no es una operación de edición.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await tieneAccesoCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Calidad" }, { status: 403 });
  }

  const r = await sincronizarEnvases();
  return r.ok
    ? NextResponse.json(r.datos)
    : NextResponse.json({ error: r.error, ...(r.datos ?? {}) }, { status: r.status });
}
