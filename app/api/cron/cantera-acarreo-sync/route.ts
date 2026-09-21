import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { sincronizarAcarreoDesdeSheets } from "@/lib/cantera/importarAcarreo";

export const maxDuration = 300;

/**
 * Trae de la planilla de balanza/transporte fleteros, tarifas y las pesadas
 * de "Datos", cada 15-30 min — antes esto era sólo
 * `scripts/importar-acarreo-2026.mts` corrido a mano, así que "Toneladas por
 * yacimiento" y el resumen por fletero quedaban tan viejos como la última vez
 * que alguien se acordaba de correrlo.
 *
 * Ya NO trae las 5 actividades sin pesada de "Ingreso de Datos" (horas de
 * destape, viaje de bloques, horas de bochones, viajes de estabilizado,
 * materiales Pezzuchi) — el equipo dejó de cargarlas ahí el 21/09/2026, se
 * cargan por día directo en el SdG. Ver el comentario grande de
 * `lib/cantera/importarAcarreo.ts`.
 *
 * Lo llama el workflow de GitHub Actions (`cantera-acarreo-sync.yml`), igual
 * que Compras; el cron diario de `vercel.json` queda como red de seguridad
 * por si Actions falla, con el mismo `CRON_SECRET` que ya usan los otros.
 *
 * Falla cerrado: sin CRON_SECRET configurado devuelve 503 en vez de quedar
 * abierto a cualquiera que conozca la URL.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  try {
    const resultado = await sincronizarAcarreoDesdeSheets(true);
    return NextResponse.json(resultado);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
