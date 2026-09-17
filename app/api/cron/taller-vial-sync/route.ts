import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { sincronizarCargasDesdeSheets } from "@/lib/tallerVial/importar";

export const maxDuration = 300;

/**
 * Trae de la planilla real de Taller Vial ("DATOS") las cargas de combustible
 * cada 20-30 min. Lo llama el workflow de GitHub Actions
 * (`taller-vial-sync.yml`), igual que Cantera; el cron diario de
 * `vercel.json` queda como red de seguridad si Actions falla.
 *
 * Falla cerrado: sin CRON_SECRET configurado devuelve 503 en vez de quedar
 * abierto a cualquiera que conozca la URL.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  try {
    const resultado = await sincronizarCargasDesdeSheets(true);
    return NextResponse.json(resultado);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
