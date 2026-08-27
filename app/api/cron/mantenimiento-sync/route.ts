import { NextResponse } from "next/server";
import { SINCRONIZACIONES } from "@/lib/mantenimiento/sincronizar";

export const maxDuration = 300;

/**
 * Trae de sus planillas todo lo que Mantenimiento espeja.
 *
 * Hasta ahora había que acordarse de apretar el botón en cada pantalla, y lo
 * que se ve en el sistema era tan viejo como la última vez que alguien lo hizo.
 *
 * Lo llaman dos relojes, igual que el de Compras: el cron diario de Vercel que
 * está en `vercel.json`, y el workflow de GitHub Actions cada quince minutos.
 * El de Vercel queda como red por si Actions falla; la frecuencia real la marca
 * el otro, porque el plan Hobby no admite crons más seguidos que un día.
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

  const resultados: Record<string, unknown> = {};
  const fallaron: string[] = [];

  // Una por una y sin cortar: que la planilla de OS no se pueda leer no es
  // razón para dejar los avisos sin actualizar. Cada una ya registró su
  // corrida, así que la pantalla va a mostrar cuál quedó vieja y por qué.
  for (const { recurso, correr } of SINCRONIZACIONES) {
    try {
      const r = await correr();
      resultados[recurso] = r.ok ? r.datos : { error: r.error };
      if (!r.ok) fallaron.push(recurso);
    } catch (e) {
      resultados[recurso] = { error: e instanceof Error ? e.message : String(e) };
      fallaron.push(recurso);
    }
  }

  // 207: algunas salieron y otras no. Un 200 escondería el problema y un 500
  // haría pensar que no se actualizó nada.
  return NextResponse.json(
    { resultados, fallaron },
    { status: fallaron.length === 0 ? 200 : 207 }
  );
}
