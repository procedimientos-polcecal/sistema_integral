import { NextResponse } from "next/server";
import { importarDesdeSheets } from "@/lib/compras/sheets";

export const maxDuration = 300;

/**
 * Trae de la planilla los RI nuevos cada 2 horas, mientras dure la transición.
 *
 * Falla cerrado: sin CRON_SECRET configurado devuelve 503 en vez de quedar
 * abierto a cualquiera que conozca la URL.
 */
export async function GET(request: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 503 });
  }

  if (request.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Sin planilla configurada no hay nada que sincronizar; no es un error.
  if (!process.env.GOOGLE_SHEETS_COMPRAS_ID) {
    return NextResponse.json({ omitido: "GOOGLE_SHEETS_COMPRAS_ID no configurado" });
  }

  try {
    return NextResponse.json(await importarDesdeSheets("cron"));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
