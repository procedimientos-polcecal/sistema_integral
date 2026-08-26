import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { nivelMantenimientoDe, usuariosConAccesoMantenimiento } from "@/lib/mantenimiento/auth";
import PlanDetalle from "./PlanDetalle";
import { sectoresDePlanta } from "@/lib/mantenimiento/sectores";

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  const canEdit = nivel === "edicion" || nivel === "admin";

  const [{ data: plan }, { data: pendingOTs }, usuarios, sectores] = await Promise.all([
    supabase.from("planificacion_diaria")
      .select("*, created_by_user:created_by(nombre, apellido), planificacion_diaria_items(*, assigned_user:assigned_to(nombre, apellido))")
      .eq("id", id).single(),
    // OTs pendientes (no REALIZADO)
    supabase.from("ordenes_trabajo")
      .select("id, ot_number, especialidad, sector_raw, equipo_raw, descripcion, repuesto, fecha_ejecucion, estado, sector_id")
      .in("estado", ["POR_HACER", "EN_PROCESO", "ATRASADO"])
      .order("ot_number", { ascending: false })
      .limit(300),
    usuariosConAccesoMantenimiento(supabase),
    sectoresDePlanta(supabase),
  ]);

  if (!plan) notFound();

  return (
    <PlanDetalle
      plan={plan}
      pendingOTs={pendingOTs ?? []}
      usuarios={usuarios}
      sectores={sectores}
      canEdit={canEdit}
    />
  );
}
