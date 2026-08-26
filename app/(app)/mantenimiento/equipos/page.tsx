import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import EquiposClient from "./EquiposClient";
import { sectoresDePlanta } from "@/lib/mantenimiento/sectores";

export default async function EquiposPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: empresas }, sectores, { data: equipos }] = await Promise.all([
    supabase.from("empresas").select("*").order("nombre"),
    sectoresDePlanta(supabase, "*, empresas(nombre)"),
    supabase
      .from("equipos")
      .select("*, sectores(nombre, empresas(nombre))")
      .eq("is_active", true)
      .order("code"),
  ]);

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  const canEdit = nivel === "edicion" || nivel === "admin";

  return (
    <EquiposClient
      empresas={empresas ?? []}
      sectores={sectores}
      equipos={equipos ?? []}
      canEdit={canEdit}
    />
  );
}
