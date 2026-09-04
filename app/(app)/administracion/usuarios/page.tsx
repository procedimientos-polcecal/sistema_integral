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

  // El `select` va en una sola cadena literal: partido en dos con un `+`,
  // Supabase pierde la inferencia y todo lo que sale queda como error de
  // string. Es la trampa que el README de migraciones deja anotada.
  const [{ data: usuarios }, { data: areas }] = await Promise.all([
    admin
      .from("usuarios")
      .select("id, email, nombre, apellido, rol, activo, usuario_modulos(id, modulo, nivel), usuario_areas_compras(area_id)")
      .order("email"),
    // De qué área es cada uno decide qué requerimientos ve primero en Mis
    // pedidos. No es un permiso —la lectura de compras es abierta desde la
    // 018— pero se carga acá porque el área de una persona no es una
    // preferencia suya.
    admin.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
  ]);

  return <UsuariosClient usuariosIniciales={usuarios ?? []} areas={areas ?? []} />;
}
