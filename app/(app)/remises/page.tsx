import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import HoyClient from "./HoyClient";

export default async function RemisesHoyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase.from("usuarios").select("nombre").eq("id", user.id).single();
  const { data: turnos } = await supabase.from("remises_turnos").select("*").eq("activo", true).order("nombre");

  return <HoyClient nombreUsuario={usuario?.nombre ?? ""} turnos={turnos ?? []} />;
}
