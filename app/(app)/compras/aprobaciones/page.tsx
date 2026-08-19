import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosComprasDe } from "@/lib/compras/auth";
import AprobacionesClient from "./AprobacionesClient";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";

export default async function AprobacionesPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosComprasDe(supabase, user.id);

  // Todo lo que espera decisión, de lo más viejo a lo más nuevo: el cliente
  // lo reordena por urgencia sin perder la antigüedad como desempate.
  const { data } = await supabase
    .from("compras_requerimientos")
    .select("*, compras_areas(nombre), empresas(nombre), proveedores(nombre), compras_ubicaciones(nombre)")
    .in("estado_aprobacion", ["PENDIENTE", "EN_REVISION"])
    .order("fecha", { ascending: true });

  return (
    <AprobacionesClient
      pendientes={(data ?? []) as RequerimientoConRelaciones[]}
      puedeAprobar={permisos.puedeAprobar}
    />
  );
}
