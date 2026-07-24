import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import EjecucionesClient from "./EjecucionesClient";

export default async function EjecucionesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: schedules }, { data: executions }] = await Promise.all([
    supabase
      .from("mantenimientos_programados")
      .select("id, maintenance_type, schedule_type, next_date, description, estimated_hours, equipos(id, name, code, sectores(nombre, empresas(nombre))), assigned_user:assigned_to(id, nombre, apellido)")
      .eq("status", "active")
      .order("next_date", { ascending: true }),
    supabase
      .from("mantenimientos_ejecuciones")
      .select("*, schedule:schedule_id(maintenance_type, equipos(name, code)), executor:executed_by(nombre, apellido)")
      .order("executed_at", { ascending: false })
      .limit(50),
  ]);

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  const canExecute = nivel !== null;

  return (
    <EjecucionesClient
      schedules={schedules ?? []}
      executions={executions ?? []}
      currentUserId={user.id}
      canExecute={canExecute}
    />
  );
}
