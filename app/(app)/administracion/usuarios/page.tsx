import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import UsuariosClient from "./UsuariosClient";

export default async function UsuariosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  const esAdmin = usuario?.rol === "admin_sistema" || usuario?.rol === "admin";
  if (!esAdmin) redirect("/");

  const admin = createAdminClient();
  const { data: usuarios } = await admin
    .from("usuarios")
    .select("id, email, nombre, apellido, rol, activo, usuario_modulos(id, modulo, nivel)")
    .order("email");

  return <UsuariosClient usuariosIniciales={usuarios ?? []} />;
}
