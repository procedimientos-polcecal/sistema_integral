import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import PlanificacionClient from "./PlanificacionClient";

export default async function PlanificacionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  const canEdit = nivel === "edicion" || nivel === "admin";

  const { data: plans } = await supabase
    .from("planificacion_diaria")
    .select("*, created_by_user:created_by(nombre, apellido), planificacion_diaria_items(id)")
    .order("fecha", { ascending: false })
    .limit(30);

  return <PlanificacionClient plans={plans ?? []} canEdit={canEdit} />;
}
