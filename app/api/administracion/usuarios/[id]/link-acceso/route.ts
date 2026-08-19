import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { es_admin_check } from "@/lib/core/route-utils";
import { generarLinkAcceso, intentarEnviarCorreo, urlBase } from "@/lib/core/auth-links";

/**
 * Vuelve a generar el link para definir contraseña de un usuario que ya existe.
 *
 * Sirve cuando el correo no llego, cuando el link caduco, o para blanquear el
 * acceso de alguien que se olvido la contrasena. El link es de un solo uso y
 * hay que tratarlo como una contrasena temporal.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const { data: usuario } = await createAdminClient()
    .from("usuarios")
    .select("email, activo")
    .eq("id", id)
    .maybeSingle();

  if (!usuario) return NextResponse.json({ error: "El usuario no existe" }, { status: 404 });
  if (!usuario.activo) {
    return NextResponse.json(
      { error: "El usuario esta desactivado. Reactivalo antes de darle un link de acceso." },
      { status: 409 }
    );
  }

  const base = urlBase(request);
  const { link, error } = await generarLinkAcceso(usuario.email, base);
  if (error) return NextResponse.json({ error }, { status: 500 });

  const errorCorreo = await intentarEnviarCorreo(usuario.email, base);

  return NextResponse.json({
    link_acceso: link,
    aviso: errorCorreo
      ? "No se pudo enviar el correo. Pasale el link vos."
      : "Tambien se le envio por correo.",
  });
}
