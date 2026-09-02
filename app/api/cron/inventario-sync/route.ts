import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { sincronizarInventario } from "@/lib/inventario/sincronizar";

export const maxDuration = 300;

/**
 * Trae de la planilla el catálogo y el kardex del almacén.
 *
 * El reloj hace falta más acá que en los otros módulos, y por una razón
 * concreta: desde este spec, Mantenimiento consulta el stock de un repuesto
 * contra `inventario_articulos` y no contra la planilla en vivo. Sin reloj, ese
 * número sería tan viejo como la última vez que alguien apretó el botón —o sea,
 * peor que leer el Sheets, que era lo que hacía antes—.
 *
 * Dos relojes, igual que Compras y Mantenimiento: el workflow de GitHub Actions
 * cada quince minutos, que marca la frecuencia real, y el cron diario de
 * `vercel.json` como red. El plan Hobby no admite crons más seguidos que un
 * día, y poner una frecuencia mayor no degrada el cron: hace fallar el deploy
 * entero.
 *
 * Falla cerrado: sin CRON_SECRET configurado devuelve 503 en vez de quedar
 * abierto a cualquiera que conozca la URL.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  const r = await sincronizarInventario();
  return r.ok
    ? NextResponse.json(r.datos)
    : NextResponse.json({ error: r.error, ...(r.datos ?? {}) }, { status: r.status });
}
