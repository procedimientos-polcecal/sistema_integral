import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { opcionesAprobacion } from "@/lib/compras/sheets";

/** Opciones del desplegable de aprobacion, leidas de la planilla. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!process.env.GOOGLE_SHEETS_COMPRAS_ID) return NextResponse.json({ opciones: [] });

  try {
    return NextResponse.json({ opciones: await opcionesAprobacion() });
  } catch {
    // Si la planilla no responde, la pantalla igual deja escribir el alias a mano.
    return NextResponse.json({ opciones: [] });
  }
}
