import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import ImprimirClient from "./ImprimirClient";

export default async function ImprimirPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // El original no verificaba sesión/rol en esta ruta (accesible con el link directo).
  const nivel = await nivelMantenimientoDe(supabase, user.id);
  if (!nivel) redirect("/");

  const { data: plan } = await supabase
    .from("planificacion_diaria")
    .select("*, planificacion_diaria_items(*, assigned_user:assigned_to(nombre, apellido))")
    .eq("id", id).single();

  if (!plan) notFound();
  const items = [...(plan.planificacion_diaria_items ?? [])].sort((a: any, b: any) => a.orden - b.orden);
  return <ImprimirClient plan={plan} items={items} />;
}
