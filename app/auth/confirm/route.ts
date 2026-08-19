import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Canjea el `?code=` de los links de correo (recuperacion de contrasena y alta
 * de usuarios) por una sesion, y despues manda a donde corresponda.
 *
 * Tiene que ser un Route Handler y no una pagina: el canje deja cookies, y en
 * un Server Component `cookies().set()` no hace nada — el cliente de
 * lib/supabase/server.ts se traga ese error a proposito. Si esto viviera en la
 * pagina, la sesion existiria solo durante ese render y el formulario despues
 * no tendria con que guardar la contrasena.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // `next` es interno: solo se aceptan rutas relativas, para que un link
  // manipulado no pueda usar esto como redirector a otro sitio.
  const nextParam = searchParams.get("next") ?? "/reset-password";
  const destino = nextParam.startsWith("/") && !nextParam.startsWith("//")
    ? nextParam
    : "/reset-password";

  if (!code) return NextResponse.redirect(`${origin}/login?error=link_invalido`);

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=link_invalido`);

  return NextResponse.redirect(`${origin}${destino}`);
}
