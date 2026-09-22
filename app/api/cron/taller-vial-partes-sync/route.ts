import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { sincronizarPartesDesdeSheets } from "@/lib/tallerVial/importarPartes";

export const maxDuration = 300;

/**
 * Trae del Google Form "PARTE DIARIO EQUIPOS MÓVILES" los partes diarios
 * nuevos cada 20 min, y crea la fila en Destape que corresponda — ver
 * `lib/tallerVial/importarPartes.ts`. Lo llama el workflow de GitHub
 * Actions (`taller-vial-partes-sync.yml`), mismo patrón que
 * `taller-vial-sync`.
 *
 * Falla cerrado: sin CRON_SECRET configurado devuelve 503 en vez de quedar
 * abierto a cualquiera que conozca la URL.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  try {
    const resultado = await sincronizarPartesDesdeSheets(true);
    return NextResponse.json(resultado);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
