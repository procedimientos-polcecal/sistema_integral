import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { es_admin_check } from "@/lib/core/route-utils";

export async function GET() {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const admin = createAdminClient();
  const { data: usuarios, error } = await admin
    .from("usuarios")
    .select("id, email, nombre, apellido, rol, activo, usuario_modulos(id, modulo, nivel)")
    .order("email");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(usuarios);
}

/**
 * Crea un usuario sin manejar nunca una contraseña en texto plano: lo crea en
 * Supabase Auth sin contraseña propia y le manda un link de "definir
 * contraseña" por email — mismo patrón que
 * app/api/remises/empleados/[id]/cuenta/route.ts usa para altas de empleados.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await request.json();
  const email = String(body.email ?? "").trim().toLowerCase();
  const nombre = String(body.nombre ?? "").trim();
  const apellido = String(body.apellido ?? "").trim();
  const rol = body.rol;
  if (!email || !nombre || !apellido) {
    return NextResponse.json({ error: "Completá email, nombre y apellido" }, { status: 400 });
  }
  if (!["admin_sistema", "admin", "encargado", "operario"].includes(rol)) {
    return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: yaExiste } = await admin.from("usuarios").select("id").eq("email", email).maybeSingle();
  if (yaExiste) return NextResponse.json({ error: "Ya existe un usuario con ese email" }, { status: 409 });

  const { data: nuevoAuth, error: errorAuth } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (errorAuth || !nuevoAuth.user) {
    return NextResponse.json({ error: errorAuth?.message ?? "No se pudo crear la cuenta" }, { status: 400 });
  }

  const { error: errorUsuario } = await admin.from("usuarios").insert({
    id: nuevoAuth.user.id,
    email,
    nombre,
    apellido,
    rol,
    activo: true,
  });
  if (errorUsuario) {
    await admin.auth.admin.deleteUser(nuevoAuth.user.id);
    return NextResponse.json({ error: errorUsuario.message }, { status: 500 });
  }

  const { error: errorLink } = await supabase.auth.resetPasswordForEmail(email);
  if (errorLink) {
    return NextResponse.json(
      { error: `Usuario creado pero no se pudo enviar el link de acceso: ${errorLink.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
