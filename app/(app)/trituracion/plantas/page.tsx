import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelTrituracionDe } from "@/lib/trituracion/auth";
import { traerPlantas } from "@/lib/trituracion/consultas";
import PlantasClient from "./PlantasClient";

/** El catálogo de plantas (hoy 3, fijas). Sólo admin del módulo. */
export default async function PlantasTrituracionPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelTrituracionDe(supabase, user.id);
  if (!nivel) redirect("/");
  if (nivel !== "admin") redirect("/trituracion");

  return <PlantasClient plantas={await traerPlantas(supabase, false)} />;
}
