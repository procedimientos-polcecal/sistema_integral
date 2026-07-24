import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import EquipoDetalle from "./EquipoDetalle";

export default async function EquipoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: equipo }, { data: sectores }, { data: historial }] = await Promise.all([
    supabase
      .from("equipos")
      .select("*, sectores(id, nombre, empresas(id, nombre))")
      .eq("id", id)
      .single(),
    supabase
      .from("sectores")
      .select("id, nombre, empresas(id, nombre)")
      .order("nombre"),
    supabase
      .from("equipos_status_log")
      .select("*, changed_by_user:changed_by(nombre, apellido)")
      .eq("equipment_id", id)
      .order("changed_at", { ascending: false })
      .limit(10),
  ]);

  if (!equipo) notFound();

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  const canEdit = nivel === "edicion" || nivel === "admin";

  return (
    <EquipoDetalle
      equipo={equipo}
      sectores={sectores ?? []}
      historial={historial ?? []}
      canEdit={canEdit}
    />
  );
}
