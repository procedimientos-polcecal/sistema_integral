import { createClient } from "@/lib/supabase/server";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
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

  // Los contratistas son proveedores del núcleo desde la 032, y las 427
  // órdenes contratadas tienen el enlace puesto: se filtra por `proveedor_id` y
  // no por el texto de la columna `contratista`, que la planilla escribe a mano.
  const [sectores, { data: equipos }, { data: contratistas }] = await Promise.all([
    sectoresDePlanta(supabase),
    supabase.from("equipos").select("id, name, code, sector_id, status").eq("is_active", true).order("code"),
    supabase.from("proveedores").select("id, nombre").eq("es_contratista", true).eq("activo", true).order("nombre"),
  ]);

  // Esta pantalla espeja una planilla: cuándo se trajo es parte del dato.
  const sync = await ultimaSincronizacionDe(supabase, "mantenimiento", "ordenes");

  return (
    <OrdenesClient
      sync={sync}
      canEdit={canEdit}
      sectores={sectores}
      equipos={equipos ?? []}
      contratistas={contratistas ?? []}
    />
  );
}
