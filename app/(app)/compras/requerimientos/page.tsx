import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelComprasDe } from "@/lib/compras/auth";
import RequerimientosClient from "./RequerimientosClient";

export default async function RequerimientosPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: areas }, { data: proveedores }, { data: empresas }, { data: sectores }, { data: equipos }] =
    await Promise.all([
      supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
      supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre"),
      supabase.from("empresas").select("id, nombre").order("nombre"),
      supabase.from("sectores").select("id, nombre").eq("activo", true).order("nombre"),
      supabase.from("equipos").select("id, name, code").eq("is_active", true).order("code"),
    ]);

  const nivel = await nivelComprasDe(supabase, user.id);

  return (
    <RequerimientosClient
      areas={areas ?? []}
      proveedores={proveedores ?? []}
      empresas={empresas ?? []}
      sectores={sectores ?? []}
      equipos={equipos ?? []}
      canEdit={nivel === "edicion" || nivel === "admin"}
    />
  );
}
