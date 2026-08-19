import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { importarDesdeSheets } from "@/lib/compras/sheets";

export const maxDuration = 300;

/** Sincronización manual, desde el botón de /compras/configuracion. */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés permiso para sincronizar la planilla" }, { status: 403 });
  }

  if (!process.env.GOOGLE_SHEETS_COMPRAS_ID) {
    return NextResponse.json(
      { error: "Falta configurar GOOGLE_SHEETS_COMPRAS_ID" },
      { status: 503 }
    );
  }

  try {
    return NextResponse.json(await importarDesdeSheets("manual"));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
