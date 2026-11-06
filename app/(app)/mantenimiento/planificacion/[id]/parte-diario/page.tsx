import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import ParteDiarioClient from "./ParteDiarioClient";

/**
 * El parte diario del plan, para imprimir.
 *
 * Carga lo mismo que `imprimir/` y con los mismos controles de sesión y nivel:
 * son dos vistas del mismo plan —una OT por página aquélla, el turno entero en
 * una tabla ésta— y una ruta de impresión abierta por link directo es una ruta
 * abierta igual.
 */
export default async function ParteDiarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  if (!nivel) redirect("/");

  const { data: plan } = await supabase
    .from("planificacion_diaria")
    .select("id, fecha, titulo, planificacion_diaria_items(id, ot_number, sector_raw, equipo_raw, descripcion, repuesto, orden)")
    .eq("id", id)
    .single();

  if (!plan) notFound();

  const items = [...(plan.planificacion_diaria_items ?? [])].sort((a, b) => a.orden - b.orden);
  return <ParteDiarioClient plan={plan} items={items} />;
}
