import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelComprasDe } from "@/lib/compras/auth";
import UbicacionesClient from "./UbicacionesClient";
import type { UbicacionCompras } from "@/lib/compras/types";

export default async function UbicacionesPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: ubicaciones }, { data: usos }, { data: sectores }, { data: equipos }] =
    await Promise.all([
      supabase.from("compras_ubicaciones").select("*").order("orden").order("nombre"),
      supabase.from("compras_requerimientos").select("ubicacion_id").not("ubicacion_id", "is", null),
      supabase.from("sectores").select("id, nombre").eq("activo", true).order("nombre"),
      supabase.from("equipos").select("id, name, code").eq("is_active", true).order("code"),
    ]);

  // Cuántos requerimientos usa cada ubicación: es el dato que decide si se
  // puede borrar y cuál conviene conservar al fusionar.
  const conteo: Record<string, number> = {};
  for (const r of usos ?? []) {
    const id = r.ubicacion_id as string;
    conteo[id] = (conteo[id] ?? 0) + 1;
  }

  const nivel = await nivelComprasDe(supabase, user.id);

  return (
    <UbicacionesClient
      ubicaciones={(ubicaciones ?? []) as UbicacionCompras[]}
      conteo={conteo}
      sectores={sectores ?? []}
      equipos={equipos ?? []}
      canEdit={nivel === "edicion" || nivel === "admin"}
    />
  );
}
