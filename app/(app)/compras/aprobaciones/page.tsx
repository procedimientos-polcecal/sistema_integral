import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { permisosComprasDe } from "@/lib/compras/auth";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import AprobacionesClient from "./AprobacionesClient";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";

export default async function AprobacionesPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const permisos = await permisosComprasActuales();

  // Todo lo que espera decisión, de lo más viejo a lo más nuevo: el cliente
  // lo reordena por urgencia sin perder la antigüedad como desempate.
  const { data } = await supabase
    .from("compras_requerimientos")
    // `!empresa_id`: `compras_odoo_ordenes` abre un segundo camino hasta `empresas` (PGRST201).
    .select("*, compras_areas(nombre), empresas!empresa_id(nombre), proveedores(nombre), compras_ubicaciones(nombre)")
    .in("estado_aprobacion", ["PENDIENTE", "EN_REVISION"])
    .order("fecha", { ascending: true });

  return (
    <AprobacionesClient
      pendientes={(data ?? []) as RequerimientoConRelaciones[]}
      puedeAprobar={permisos.puedeAprobar}
    />
  );
}
