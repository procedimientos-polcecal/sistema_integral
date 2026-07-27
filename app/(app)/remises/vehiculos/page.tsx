import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import VehiculosClient from "./VehiculosClient";

export default async function VehiculosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: vehiculos }, { data: choferes }] = await Promise.all([
    supabase.from("vehiculos").select("*, choferes(id, nombre, telefono)").order("nombre"),
    supabase.from("choferes").select("*").order("nombre"),
  ]);

  return <VehiculosClient vehiculos={vehiculos ?? []} choferes={choferes ?? []} />;
}
