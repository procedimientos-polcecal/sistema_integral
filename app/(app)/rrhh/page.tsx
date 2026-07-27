import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";

export default async function RrhhDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase.from("usuarios").select("nombre").eq("id", user.id).single();
  const [{ data: empresas }, { data: sectores }] = await Promise.all([
    supabase.from("empresas").select("id, nombre").order("nombre"),
    supabase.from("sectores").select("id, nombre").order("nombre"),
  ]);

  return <DashboardClient nombreUsuario={usuario?.nombre ?? ""} empresas={empresas ?? []} sectores={sectores ?? []} />;
}
