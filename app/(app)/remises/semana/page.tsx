import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SemanaClient from "./SemanaClient";

export default async function SemanaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: turnos } = await supabase.from("remises_turnos").select("*").eq("activo", true).order("nombre");

  return <SemanaClient turnos={turnos ?? []} />;
}
