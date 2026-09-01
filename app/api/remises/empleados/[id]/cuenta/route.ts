import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { es_admin_check } from "@/lib/remises/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";

/** ¿Este empleado ya tiene una cuenta de auto-servicio vinculada? (usa el cliente admin: `usuarios` no es legible por un admin de módulo vía RLS). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: empleadoId } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const admin = createAdminClient();
  const { data } = await admin.from("usuarios").select("email").eq("empleado_id", empleadoId).maybeSingle();
  return NextResponse.json({ email: data?.email ?? null });
}

/**
 * Crea (o vincula) una cuenta de auto-servicio "Mi remis" para un empleado.
 * Nunca maneja una contraseña en texto plano: crea el usuario en Supabase
 * Auth sin contraseña propia y le manda un link de "definir contraseña" por
 * email — mismo criterio que RRHH usa para reenviar acceso a un empleado.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: empleadoId } = await params;
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "Ingresá un email" }, { status: 400 });

  const { data: empleado } = await supabase.from("empleados").select("nombre, apellido").eq("id", empleadoId).single();
  if (!empleado) return NextResponse.json({ error: "Empleado no encontrado" }, { status: 404 });

  const admin = createAdminClient();

  const { data: yaVinculado } = await supabase.from("usuarios").select("id").eq("email", email).maybeSingle();
  if (!yaVinculado) {
    const { data: nuevoAuth, error: errorAuth } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (errorAuth || !nuevoAuth.user) {
      return NextResponse.json({ error: errorAuth?.message ?? "No se pudo crear la cuenta" }, { status: 400 });
    }
    const { error: errorUsuario } = await admin.from("usuarios").insert({
      id: nuevoAuth.user.id,
      email,
      nombre: empleado.nombre,
      apellido: empleado.apellido,
      rol: "operario",
      empleado_id: empleadoId,
    });
    if (errorUsuario) return NextResponse.json({ error: errorUsuario.message }, { status: 500 });
  } else {
    await admin.from("usuarios").update({ empleado_id: empleadoId }).eq("id", yaVinculado.id);
  }

  const { error: errorLink } = await supabase.auth.resetPasswordForEmail(email);
  if (errorLink) return NextResponse.json({ error: `Cuenta creada pero no se pudo enviar el link de acceso: ${errorLink.message}` }, { status: 500 });

  return NextResponse.json({ ok: true });
}
