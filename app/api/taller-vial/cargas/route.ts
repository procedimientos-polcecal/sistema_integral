import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tieneAccesoTallerVial } from "@/lib/tallerVial/auth";
import { traerCargas } from "@/lib/tallerVial/consultas";

/**
 * Las cargas de combustible de Taller Vial: sólo lectura. Se cargan en la
 * planilla real y llegan acá por `lib/tallerVial/importar.ts`, corrido cada
 * 20-30 min por `/api/cron/taller-vial-sync` — no hay `POST` ni `DELETE`
 * desde la app, mismo criterio que `cantera_pesadas`.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoTallerVial(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Taller Vial" }, { status: 403 });
  }

  const url = new URL(request.url);
  const equipoId = url.searchParams.get("equipo_id") ?? undefined;
  const mes = url.searchParams.get("mes") ?? undefined;
  if (mes && !/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ error: "El mes va como YYYY-MM" }, { status: 400 });
  }

  return NextResponse.json({ data: await traerCargas(supabase, { equipoId, mes }) });
}
