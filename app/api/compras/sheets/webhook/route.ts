import { NextResponse } from "next/server";
import { importarDesdeSheets } from "@/lib/compras/sheets";

export const maxDuration = 300;

/**
 * Lo llama el Apps Script de la planilla al editarla, para que un RI nuevo
 * aparezca sin esperar al cron. Ver docs/compras-apps-script.gs.
 *
 * Falla cerrado si falta el secreto.
 */
export async function POST(request: Request) {
  const secreto = process.env.SHEETS_WEBHOOK_SECRET;
  if (!secreto) {
    return NextResponse.json({ error: "SHEETS_WEBHOOK_SECRET no configurado" }, { status: 503 });
  }

  const enviado =
    request.headers.get("x-webhook-secret") ??
    new URL(request.url).searchParams.get("secret");

  if (enviado !== secreto) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    return NextResponse.json(await importarDesdeSheets("webhook"));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
