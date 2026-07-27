import webpush from "web-push";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_WEBPUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEBPUSH_VAPID_PRIVATE_KEY;
  const contactEmail = process.env.WEBPUSH_CONTACT_EMAIL;
  if (!publicKey || !privateKey || !contactEmail) {
    throw new Error("Faltan variables de entorno de Web Push (VAPID)");
  }
  webpush.setVapidDetails(`mailto:${contactEmail}`, publicKey, privateKey);
  configured = true;
}

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Envía una notificación Web Push. Devuelve false si la suscripción ya no es válida (para que el caller la borre). */
export async function enviarPush(sub: PushSubscriptionRow, payload: { title: string; body: string }): Promise<boolean> {
  ensureConfigured();
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload)
    );
    return true;
  } catch (e: any) {
    if (e?.statusCode === 404 || e?.statusCode === 410) return false; // suscripción vencida/inválida
    throw e;
  }
}
