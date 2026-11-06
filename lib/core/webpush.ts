import webpush from "web-push";

/**
 * El envío de una notificación Web Push.
 *
 * Vivía en `lib/remises/` porque Remises era el único que notificaba. Ahora
 * notifica el sistema entero, así que es del núcleo.
 */

let configurado = false;

function asegurarConfiguracion() {
  if (configurado) return;
  const clavePublica = process.env.NEXT_PUBLIC_WEBPUSH_VAPID_PUBLIC_KEY;
  const clavePrivada = process.env.WEBPUSH_VAPID_PRIVATE_KEY;
  const correoContacto = process.env.WEBPUSH_CONTACT_EMAIL;
  if (!clavePublica || !clavePrivada || !correoContacto) {
    throw new Error("Faltan variables de entorno de Web Push (VAPID)");
  }
  webpush.setVapidDetails(`mailto:${correoContacto}`, clavePublica, clavePrivada);
  configurado = true;
}

/** Una suscripción tal como la guarda `push_suscripciones`. */
export interface SuscripcionPush {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface Aviso {
  title: string;
  body: string;
  /**
   * A dónde lleva al tocarla. **Va siempre**: el `notificationclick` de
   * `public/sw.js` lee `data.url` y cae en `/` cuando no viene, así que una
   * notificación sin esto deja a la persona en el inicio a buscar sola de qué
   * se trataba el aviso.
   */
  url: string;
}

/** Qué pasó con un envío. `vencida` es la única que el caller tiene que actuar: esa fila se borra. */
export type ResultadoEnvio = "enviada" | "vencida" | "fallo";

/**
 * Manda una notificación a **un** aparato.
 *
 * Los tres resultados son distintos a propósito y el caller los trata distinto:
 *
 *   - `vencida` (404/410) es el push service diciendo que esa suscripción ya no
 *     existe —desinstalaron la app, limpiaron el navegador—. **Esa fila se
 *     borra**, o si no se reintenta para siempre contra un aparato que no está.
 *   - `fallo` es cualquier otra cosa: el push service caído, un 429, un error de
 *     red. La fila **se conserva**: el problema es del otro lado y la próxima
 *     corrida puede andar. Borrarla acá sería desuscribir a alguien por una
 *     caída ajena.
 *
 * Antes esto tiraba ante cualquier error que no fuera 404/410, lo que en un
 * cron que recorre a todos significaba que un push service con problemas cortaba
 * el envío a **todos los que venían después**. Un aparato que falla no puede
 * callar al resto.
 */
export async function enviarPush(sub: SuscripcionPush, aviso: Aviso): Promise<ResultadoEnvio> {
  asegurarConfiguracion();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(aviso)
    );
    return "enviada";
  } catch (e) {
    const codigo = (e as { statusCode?: number })?.statusCode;
    if (codigo === 404 || codigo === 410) return "vencida";
    console.error("push: fallo el envio", codigo ?? "", (e as Error)?.message ?? e);
    return "fallo";
  }
}
