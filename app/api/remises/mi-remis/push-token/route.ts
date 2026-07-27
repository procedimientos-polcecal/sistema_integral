import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_WEBPUSH_VAPID_PUBLIC_KEY;
  if (!publicKey) return NextResponse.json({ error: "Notificaciones no configuradas" }, { status: 500 });
  return NextResponse.json({ publicKey });
}

/** Guarda la PushSubscription del navegador para el usuario logueado (admin o empleado de auto-servicio, cualquiera puede tener una). */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await request.json();
  const endpoint = body.endpoint;
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (!endpoint || !p256dh || !auth) return NextResponse.json({ error: "Suscripción inválida" }, { status: 400 });

  const { error } = await supabase
    .from("remises_push_tokens")
    .upsert({ usuario_id: user.id, endpoint, p256dh, auth }, { onConflict: "usuario_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
