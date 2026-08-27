import { NextResponse } from "next/server";
import { SINCRONIZACIONES } from "@/lib/mantenimiento/sincronizar";

export const maxDuration = 300;

/**
 * Lo llama el Apps Script de cada planilla cuando la editan, para que el cambio
 * aparezca sin esperar al cron. Ver `docs/mantenimiento-apps-script.gs`.
 *
 * Es uno solo para las cuatro planillas y recibe cuál cambió: cuatro endpoints
 * iguales serían cuatro lugares donde arreglar lo mismo. La planilla dice quién
 * es con `?recurso=`, y el Apps Script es el mismo archivo con una propiedad
 * distinta en cada una.
 *
 * No recibe el contenido de la celda: sólo el aviso de que hubo un cambio, y la
 * app relee la planilla. Así el secreto es lo único que viaja.
 *
 * Falla cerrado si falta el secreto.
 */
export async function POST(request: Request) {
  const secreto = process.env.SHEETS_WEBHOOK_SECRET;
  if (!secreto) {
    return NextResponse.json({ error: "SHEETS_WEBHOOK_SECRET no configurado" }, { status: 503 });
  }

  const url = new URL(request.url);
  const enviado =
    request.headers.get("x-webhook-secret") ?? url.searchParams.get("secret");

  if (enviado !== secreto) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const pedido = url.searchParams.get("recurso");

  // Sin recurso se corren todas: una planilla mal configurada tiene que traer
  // de más, no de menos. Tarda unos segundos más y nadie está esperando.
  const aCorrer = pedido
    ? SINCRONIZACIONES.filter((s) => s.recurso === pedido)
    : SINCRONIZACIONES;

  if (aCorrer.length === 0) {
    return NextResponse.json(
      {
        error: `No existe el recurso "${pedido}".`,
        recursos: SINCRONIZACIONES.map((s) => s.recurso),
      },
      { status: 400 }
    );
  }

  const resultados: Record<string, unknown> = {};
  const fallaron: string[] = [];

  for (const { recurso, correr } of aCorrer) {
    try {
      const r = await correr();
      resultados[recurso] = r.ok ? r.datos : { error: r.error };
      if (!r.ok) fallaron.push(recurso);
    } catch (e) {
      resultados[recurso] = { error: e instanceof Error ? e.message : String(e) };
      fallaron.push(recurso);
    }
  }

  return NextResponse.json(
    { resultados, fallaron },
    { status: fallaron.length === 0 ? 200 : 207 }
  );
}
