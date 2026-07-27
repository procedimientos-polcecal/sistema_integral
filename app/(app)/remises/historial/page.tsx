import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import HistorialClient from "./HistorialClient";

export default async function HistorialPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: turnos } = await supabase.from("remises_turnos").select("*").eq("activo", true).order("nombre");

  return <HistorialClient turnos={turnos ?? []} />;
}
