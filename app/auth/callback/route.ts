import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Sólo se permite el ingreso con Google de cuentas de este dominio.
const DOMINIO_PERMITIDO = "polcecal.com";

/**
 * Callback de OAuth.
 *
 * El alta de usuarios la sigue haciendo un administrador: acá no se crea nadie.
 * Google sirve para entrar sin contraseña a una cuenta que ya existe, y el
 * control de dominio se hace de este lado — el `hd` que manda el botón es sólo
 * una ayuda visual de Google y se puede saltear.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // Google puede volver con un error propio (por ejemplo, permiso denegado).
  if (searchParams.get("error")) {
    return NextResponse.redirect(`${origin}/login?error=oauth`);
  }
  if (!code) return NextResponse.redirect(`${origin}/login?error=oauth`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=oauth`);

  const { data: { user } } = await supabase.auth.getUser();
  const email = (user?.email ?? "").toLowerCase();

  if (!user || !email.endsWith(`@${DOMINIO_PERMITIDO}`)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=dominio`);
  }

  // La cuenta tiene que existir y estar activa. Se consulta con el cliente
  // admin porque las políticas de `usuarios` no dejan leer a quien todavía no
  // está habilitado.
  const { data: perfil } = await createAdminClient()
    .from("usuarios")
    .select("activo")
    .eq("id", user.id)
    .maybeSingle();

  if (!perfil) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=sin_alta`);
  }
  if (!perfil.activo) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=inactivo`);
  }

  return NextResponse.redirect(`${origin}/`);
}
