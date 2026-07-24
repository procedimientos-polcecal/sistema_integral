import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import ChecklistEditor from "./ChecklistEditor";

export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  const canEdit = nivel === "edicion" || nivel === "admin";

  const [{ data: equipo }, { data: checklist }] = await Promise.all([
    supabase.from("equipos").select("id, name, code").eq("id", id).single(),
    supabase
      .from("equipos_checklists")
      .select("*")
      .eq("equipment_id", id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!equipo) notFound();

  return (
    <ChecklistEditor
      equipo={equipo}
      checklist={checklist}
      canEdit={canEdit}
    />
  );
}
