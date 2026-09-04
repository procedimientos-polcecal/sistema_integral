import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { modulosVisibles } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";
import InicioClient from "./InicioClient";

export default async function InicioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase
    .from("usuarios").select("nombre, rol").eq("id", user.id).single();
  const { data: grants } = await supabase
    .from("usuario_modulos").select("id, usuario_id, modulo, nivel").eq("usuario_id", user.id);

  // Qué módulos van, resuelto en el servidor y no esperando al resumen.
  //
  // La pantalla decidía qué tarjeta mostrar según si el resumen traía números
  // para ese módulo, y el resumen llega por fetch: hasta que contestaba, las
  // mostraba todas. Quien tiene un solo módulo veía cuatro tarjetas —tres de
  // cosas que no puede abrir— y después desaparecían tres. Es la misma lista
  // que usa el menú, así que las dos dicen lo mismo desde el primer pintado.
  const modulos = modulosVisibles(
    usuario?.rol as Rol,
    (grants ?? []) as UsuarioModulo[]
  );

  return <InicioClient nombreUsuario={usuario?.nombre ?? ""} modulos={modulos} />;
}
