import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";

/**
 * La suscripción de **un aparato** a las notificaciones del SdG.
 *
 * Vivía en `/api/remises/mi-remis/push-token` porque Remises era el único que
 * notificaba. Ahora notifica el sistema entero, así que es del núcleo — y la
 * tabla pasó a tener la clave en `(usuario_id, endpoint)`, o sea que el celular
 * y la computadora de la misma persona son dos filas y conviven. Antes la clave
 * era `usuario_id` sola y suscribirse en la segunda borraba la primera, sin
 * error y sin aviso.
 */

/** La clave pública VAPID, que el navegador necesita para suscribirse. */
export async function GET() {
  const clavePublica = process.env.NEXT_PUBLIC_WEBPUSH_VAPID_PUBLIC_KEY;
  if (!clavePublica) {
    return NextResponse.json({ error: "Las notificaciones no están configuradas" }, { status: 503 });
  }
  return NextResponse.json({ clavePublica });
}

/** Guarda la suscripción que acaba de crear el navegador de quien está logueado. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const cuerpo = await cuerpoJson(request);
  const endpoint = typeof cuerpo?.endpoint === "string" ? cuerpo.endpoint : null;
  const p256dh = typeof cuerpo?.keys?.p256dh === "string" ? cuerpo.keys.p256dh : null;
  const auth = typeof cuerpo?.keys?.auth === "string" ? cuerpo.keys.auth : null;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "La suscripción llegó incompleta" }, { status: 400 });
  }

  // `onConflict` sobre la clave entera: volver a suscribir el **mismo** aparato
  // refresca sus claves en vez de duplicarlo. El navegador rota `p256dh`/`auth`
  // cada tanto manteniendo el `endpoint`, y sin esto quedarían las viejas y los
  // envíos empezarían a fallar.
  const { error } = await supabase
    .from("push_suscripciones")
    .upsert(
      { usuario_id: user.id, endpoint, p256dh, auth },
      { onConflict: "usuario_id,endpoint" }
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

/**
 * Da de baja **este** aparato, no todos.
 *
 * Apagar las notificaciones en la computadora no tiene por qué apagarlas en el
 * teléfono, así que hace falta el `endpoint` para saber cuál.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const cuerpo = await cuerpoJson(request);
  const endpoint = typeof cuerpo?.endpoint === "string" ? cuerpo.endpoint : null;
  if (!endpoint) return NextResponse.json({ error: "Falta el endpoint del aparato" }, { status: 400 });

  const { error } = await supabase
    .from("push_suscripciones")
    .delete()
    .eq("usuario_id", user.id)
    .eq("endpoint", endpoint);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
