import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { nivelRemisesDe } from "@/lib/remises/auth";
import ImprimirClient from "./ImprimirClient";

export default async function ImprimirHojaRutaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelRemisesDe(supabase, user.id);
  if (!nivel) redirect("/");

  const { data: hoja } = await supabase
    .from("hojas_ruta")
    .select(
      "*, vehiculos(nombre), choferes(nombre, telefono), remises_turnos(nombre, hora_inicio), asientos(orden, empleados(nombre, apellido, remises_empleados_datos(direccion)))"
    )
    .eq("id", id)
    .single();

  if (!hoja) notFound();
  const asientos = [...(hoja.asientos ?? [])].sort((a: any, b: any) => a.orden - b.orden);
  return <ImprimirClient hoja={hoja} asientos={asientos} />;
}
