import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { esAdminRemises } from "@/lib/remises/auth";
import ConfiguracionClient from "./ConfiguracionClient";

export default async function ConfiguracionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await esAdminRemises(supabase, user.id))) redirect("/remises");

  const [{ data: config }, { data: turnos }] = await Promise.all([
    supabase.from("remises_config").select("*").eq("id", 1).single(),
    supabase.from("remises_turnos").select("*").order("nombre"),
  ]);

  return <ConfiguracionClient config={config} turnos={turnos ?? []} />;
}
