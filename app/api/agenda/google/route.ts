import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { revisarLaCasilla, tokenValido, conteoVacio, resumenDelConteo } from "@/lib/agenda/canales";

// Releer los eventos futuros de una casilla es una llamada a Google por evento.
export const maxDuration = 60;

/**
 * El aviso de Google: «algo cambió en un calendario» (`POST`).
 *
 * **Es público**: Google no inicia sesión. Está en la lista de endpoints de
 * máquina de `lib/supabase/middleware.ts`; sin esa línea el aviso recibe un 307
 * al login y la Agenda se queda sin enterarse de nada, sin error.
 *
 * Se verifica por el `X-Goog-Channel-Token`, que es el `secreto` que se guardó
 * en `agenda_canales` al abrir el canal (se busca por `X-Goog-Channel-ID`). **Un
 * token que no coincide —o un canal que no está— es 401 y no se mira nada más**:
 * ni la base ni Google. El 401 no dice cuál de las dos cosas falló.
 *
 * Qué hace con un aviso válido: **no usa `syncToken` ni `events.list`**. Google
 * no dice qué cambió; el SdG relee sus propias filas futuras de esa casilla y
 * las compara con `queDivergio` (`revisarLaCasilla`). La decisión, el porqué y
 * lo que cuesta están en el encabezado de `lib/agenda/canales.ts`: no se
 * «mejora» sin leerlo.
 *
 * El primer mensaje de un canal recién abierto es `sync` y no es un cambio: se
 * contesta 200 y no se hace nada.
 *
 * Qué contesta: **200 si se pudo mirar**, aunque algún evento suelto no se haya
 * podido leer —eso se registra, con la casilla, en `sincronizaciones`— y 500
 * sólo si no se pudo ni empezar, para que Google lo reintente. Nunca se traga
 * un fallo: un aviso que se apaga solo es peor que no tenerlo.
 */
export async function POST(request: Request) {
  const canalId = request.headers.get("x-goog-channel-id");
  const token = request.headers.get("x-goog-channel-token");
  const estado = request.headers.get("x-goog-resource-state");

  const noAutorizado = () => NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!canalId || !token) return noAutorizado();

  const supabase = createAdminClient();
  const { data: canal, error: errorDelCanal } = await supabase
    .from("agenda_canales")
    .select("casilla, secreto")
    .eq("canal_id", canalId)
    .maybeSingle();
  if (errorDelCanal) {
    await registrarSincronizacion({
      modulo: "agenda",
      recurso: "aviso_de_google",
      ok: false,
      error: `Llegó un aviso de Google (canal ${canalId}) y no se pudo leer agenda_canales: ${errorDelCanal.message}`,
    });
    return NextResponse.json({ error: "No se pudo comprobar el canal" }, { status: 500 });
  }
  if (!canal || !tokenValido(token, canal.secreto)) return noAutorizado();

  if (estado === "sync") return NextResponse.json({ ok: true, ignorado: "sync" });

  const fallos: string[] = [];
  // Con `maxDuration` de 60 s y hasta 30 s por lectura a Google, el corte tiene
  // que llegar antes: dos eventos lentos sin él matan la función sin dejar rastro.
  const limite = Date.now() + 25_000;
  try {
    const conteo = conteoVacio();
    const divergencias = await revisarLaCasilla(supabase, canal.casilla, fallos, new Date(), conteo, limite);

    // Lo detectado contra lo anotado: si no coinciden queda escrito, con la casilla.
    // Una carrera legítima es `ok` con la frase; un predicado roto además va a
    // `fallos` y deja la fila en rojo. Ver `ConteoDeLaRevision`.
    const resumen = resumenDelConteo(conteo);
    if (fallos.length > 0 || resumen) {
      await registrarSincronizacion({
        modulo: "agenda",
        recurso: "aviso_de_google",
        ok: fallos.length === 0,
        error: [resumen ? `${canal.casilla}: ${resumen}` : null, ...fallos].filter(Boolean).join(" · ").slice(0, 2000),
      });
    }

    // Acá se engancha el aviso al instante (Tarea 10): `divergencias` es lo que
    // acaba de divergir, y sólo eso.
    return NextResponse.json({
      ok: true,
      casilla: canal.casilla,
      divergencias: divergencias.length,
      conteo,
      fallos: fallos.length,
    });
  } catch (e) {
    const error = `${canal.casilla}: no se pudo revisar la casilla tras el aviso de Google: ${e instanceof Error ? e.message : String(e)}`;
    await registrarSincronizacion({ modulo: "agenda", recurso: "aviso_de_google", ok: false, error });
    return NextResponse.json({ error }, { status: 500 });
  }
}
