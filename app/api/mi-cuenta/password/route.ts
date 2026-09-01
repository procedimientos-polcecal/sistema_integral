import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";

/**
 * Cambia la contraseña del usuario logueado. Supabase no tiene un "verificar
 * contraseña actual" sin loguear, así que la verificación es re-autenticar
 * con signInWithPassword antes de aplicar el cambio.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await cuerpoJson(request);
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  if (newPassword.length < 6) {
    return NextResponse.json({ error: "La contraseña nueva debe tener al menos 6 caracteres" }, { status: 400 });
  }

  const { error: errorReauth } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPassword });
  if (errorReauth) {
    return NextResponse.json({ error: "La contraseña actual es incorrecta" }, { status: 400 });
  }

  const { error: errorUpdate } = await supabase.auth.updateUser({ password: newPassword });
  if (errorUpdate) return NextResponse.json({ error: errorUpdate.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
