import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { importarDesdeSheets, reintentarPendientes } from "@/lib/compras/sheets";

export const maxDuration = 300;

/**
 * Trae de la planilla los RI nuevos, mientras dure la transición.
 *
 * Lo llaman dos relojes: el cron diario de Vercel que está en vercel.json, y el
 * workflow de GitHub Actions que corre cada 15 minutos. El de Vercel queda como
 * red de seguridad por si Actions falla; la frecuencia real la marca el otro,
 * porque el plan Hobby no admite crons más seguidos que un día.
 *
 * Falla cerrado: sin CRON_SECRET configurado devuelve 503 en vez de quedar
 * abierto a cualquiera que conozca la URL.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  // Sin planilla configurada no hay nada que sincronizar; no es un error.
  if (!process.env.GOOGLE_SHEETS_COMPRAS_ID) {
    return NextResponse.json({ omitido: "GOOGLE_SHEETS_COMPRAS_ID no configurado" });
  }

  try {
    const importado = await importarDesdeSheets("cron");
    // Y de paso reintenta lo que la planilla había rechazado: casi siempre el
    // motivo se corrigió afuera (se cargó un alias, se dio un permiso).
    const reintento = await reintentarPendientes();
    return NextResponse.json({ ...importado, reintento });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
