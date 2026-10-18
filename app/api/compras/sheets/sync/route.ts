import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { importarDesdeSheets } from "@/lib/compras/sheets";

export const maxDuration = 300;

/** Sincronización manual, desde el botón de /compras/configuracion. */
/**
 * El freno de mano del borrado, levantado a mano.
 *
 * Cuando la planilla dejó de traer más filas que el tope, la sincronización no
 * borra nada y lo dice. Si ese borrado es de verdad —una limpieza grande—,
 * quien lo miró lo confirma repitiendo la llamada con `?confirmar_borrado=1`.
 *
 * Va como parámetro y no como opción guardada a propósito: vale para **esta**
 * corrida. El cron nunca lo manda, así que un borrado masivo siempre lo
 * autoriza una persona que vio el número.
 */
const confirmaElBorrado = (request: Request) =>
  new URL(request.url).searchParams.get("confirmar_borrado") === "1";

export async function POST(request: Request) {
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
    return NextResponse.json(await importarDesdeSheets("manual", { sinFreno: confirmaElBorrado(request) }));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
