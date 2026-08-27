import { NextResponse } from "next/server";

/**
 * Quién puede llamar a un cron.
 *
 * El secreto se carga a mano en dos lugares —Vercel y GitHub— y tiene que ser
 * idéntico. Se compara sin espacios ni saltos a los costados porque un Enter
 * de más al pegarlo dejaba los dos crons devolviendo 401 sin decir por qué.
 *
 * Falla cerrado: sin CRON_SECRET configurado devuelve 503 en vez de quedar
 * abierto a cualquiera que conozca la URL.
 */
export function revisarElSecreto(request: Request): NextResponse | null {
  const esperado = process.env.CRON_SECRET?.trim();
  if (!esperado) {
    return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 503 });
  }

  const recibido = (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (recibido === esperado) return null;

  return NextResponse.json({ error: "No autorizado", pista: pistaDe(recibido, esperado) }, { status: 401 });
}

/**
 * Por qué no coinciden, en términos que se puedan leer en el log de Actions.
 *
 * Nunca dice el secreto ni cuánto mide: sólo si los dos lados guardaron algo
 * del mismo largo, que es lo único que hace falta para saber si el problema es
 * que uno tiene otro valor o que falta redesplegar.
 */
function pistaDe(recibido: string, esperado: string): string {
  if (!recibido) return "no llegó el header Authorization";
  if (recibido.length !== esperado.length) {
    return "los dos lados tienen secretos de distinto largo: hay uno mal pegado";
  }
  return "mismo largo pero distinto contenido: o son valores distintos, o falta redesplegar en Vercel";
}
