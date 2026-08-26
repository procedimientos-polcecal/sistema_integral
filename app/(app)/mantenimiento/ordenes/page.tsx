import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import OrdenesClient from "./OrdenesClient";
import { sectoresDePlanta } from "@/lib/mantenimiento/sectores";

export default async function OrdenesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  const canEdit = nivel === "edicion" || nivel === "admin";

  const [sectores, { data: equipos }] = await Promise.all([
    sectoresDePlanta(supabase),
    supabase.from("equipos").select("id, name, code, sector_id, status").eq("is_active", true).order("code"),
  ]);

  return (
    <OrdenesClient
      canEdit={canEdit}
      sectores={sectores}
      equipos={equipos ?? []}
    />
  );
}
