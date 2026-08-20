import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { reintentarPendientes } from "@/lib/compras/sheets";

export const maxDuration = 300;

/** Reintenta las escrituras que la planilla habia rechazado. */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenes permiso para sincronizar" }, { status: 403 });
  }

  try {
    return NextResponse.json(await reintentarPendientes());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
