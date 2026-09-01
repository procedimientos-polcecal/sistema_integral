import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import DashboardClient from "./DashboardClient";
import { calcularResumenHoy } from "@/lib/rrhh/resumenHoy";

export default async function RrhhDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // El resumen de hoy se calcula acá, en el servidor, y viaja en el HTML: son
  // las cuatro tarjetas de arriba, lo primero que se ve. Antes la pantalla
  // llegaba vacía y las pedía por fetch recién después de hidratar.
  const [{ data: usuario }, { data: empresas }, { data: sectores }, resumenInicial] = await Promise.all([
    supabase.from("usuarios").select("nombre").eq("id", user.id).single(),
    supabase.from("empresas").select("id, nombre").order("nombre"),
    supabase.from("sectores").select("id, nombre").order("nombre"),
    calcularResumenHoy(supabase),
  ]);

  return (
    <DashboardClient
      nombreUsuario={usuario?.nombre ?? ""}
      empresas={empresas ?? []}
      sectores={sectores ?? []}
      resumenInicial={resumenInicial}
    />
  );
}
