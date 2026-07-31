import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import InicioClient from "./InicioClient";

export default async function InicioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase.from("usuarios").select("nombre").eq("id", user.id).single();

  return <InicioClient nombreUsuario={usuario?.nombre ?? ""} />;
}
