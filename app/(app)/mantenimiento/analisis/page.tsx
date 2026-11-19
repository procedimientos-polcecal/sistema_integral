import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import AnalisisClient from "./AnalisisClient";

export default async function AnalisisPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Sin acceso al módulo no hay nada que mostrar: la ruta también lo rechaza,
  // pero redirigir acá evita una pantalla que sólo dice «Sin acceso».
  const nivel = await nivelMantenimientoDe(supabase, user.id);
  if (!nivel) redirect("/");

  return <AnalisisClient canEdit={nivel === "edicion" || nivel === "admin"} />;
}
