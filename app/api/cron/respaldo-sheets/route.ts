import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { correrElRespaldo } from "@/lib/respaldo/correr";

// Siete pestañas en serie, una de ellas de ~4.200 filas. Entra cómodo, pero el
// default no alcanzaría si la ventana de RRHH creciera.
export const maxDuration = 300;

/**
 * El respaldo legible a Google Sheets, todas las noches a las 00:00 de Argentina.
 *
 * Es la tercera pata del respaldo y responde una pregunta que las otras dos no:
 *
 *   - Supabase guarda sus backups 7 días, en su infraestructura.
 *   - El dump cifrado a Drive (`.github/workflows/backup.yml`) es completo y
 *     restaurable, pero es SQL: sirve para reconstruir el sistema, no para que
 *     alguien liquide sueldos el martes a la mañana con el sistema caído.
 *   - Esto es una fotocopia legible de lo que no tiene planilla.
 *
 * **Sólo escribe en un libro propio.** No toca ninguna de las planillas que el
 * sistema sincroniza, y eso es deliberado: desde el 18/10/2026 esas
 * sincronizaciones **borran** las filas que la planilla dejó de tener, así que
 * escribirles encima el estado del sistema convertiría al respaldo en la
 * entrada del importador. El porqué completo está en
 * `lib/respaldo/instantaneas.ts`.
 *
 * Falla cerrado: sin `CRON_SECRET` devuelve 503 en vez de quedar abierto a
 * cualquiera que conozca la URL.
 *
 * Devuelve 500 **sólo si falló todo**. Si se escribieron cinco pestañas de
 * siete, eso es un respaldo parcial y no un fallo: el 200 lleva el detalle de
 * cuáles no salieron, y cada una queda anotada en `sincronizaciones` con lo que
 * dijo Google sin traducir.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  const admin = createAdminClient();

  let resultado;
  try {
    resultado = await correrElRespaldo(admin);
  } catch (e) {
    // Acá sólo caen los fallos de arranque —falta el id del libro, faltan las
    // credenciales—, que no son de una pestaña sino de todo.
    const error = e instanceof Error ? e.message : String(e);
    await registrarSincronizacion({ modulo: "respaldo", recurso: "sheets", ok: false, error });
    return NextResponse.json({ error }, { status: 500 });
  }

  // Una marca por pestaña y no una del conjunto: lo que hace falta saber es
  // cuál quedó vieja, y un "falló el respaldo" no lo dice.
  for (const p of resultado.pestanas) {
    await registrarSincronizacion({
      modulo: "respaldo",
      recurso: p.pestana,
      ok: p.ok,
      filas: p.filas,
      error: p.error ?? null,
    });
  }

  // La marca del conjunto, que es la que mira la pantalla.
  //
  // **Tiene que escribirse también cuando sale bien**, y ese fue el error: el
  // fallo de arranque anotaba `respaldo/sheets` y el éxito sólo anotaba una
  // fila por pestaña, que son otros recursos. O sea que el `sheets` en rojo del
  // 19/10 —cuando faltaba la variable— se quedó en rojo para siempre, aunque el
  // respaldo funcionara doce minutos después: `ultima_sincronizacion` devuelve
  // la última fila de **ese** recurso, y nunca hubo otra. Un indicador que no
  // puede volver a verde no es un indicador.
  await registrarSincronizacion({
    modulo: "respaldo",
    recurso: "sheets",
    ok: resultado.fallaron === 0,
    filas: resultado.pestanas.reduce((a, p) => a + p.filas, 0),
    error:
      resultado.fallaron === 0
        ? null
        : resultado.pestanas.filter((p) => !p.ok).map((p) => `${p.pestana}: ${p.error}`).join(" · "),
  });

  const todasFallaron = resultado.fallaron === resultado.pestanas.length && resultado.pestanas.length > 0;
  return NextResponse.json(resultado, { status: todasFallaron ? 500 : 200 });
}
