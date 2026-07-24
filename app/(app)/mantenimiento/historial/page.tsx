import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import HistorialClient from "./HistorialClient";

export default async function HistorialPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: executions } = await supabase
    .from("mantenimientos_ejecuciones")
    .select(`
      *,
      schedule:schedule_id(
        maintenance_type,
        schedule_type,
        equipos(name, code, sectores(nombre, empresas(nombre)))
      ),
      executor:executed_by(nombre, apellido)
    `)
    .order("executed_at", { ascending: false })
    .limit(200);

  return <HistorialClient executions={executions ?? []} />;
}
