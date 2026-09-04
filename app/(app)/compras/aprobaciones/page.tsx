import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import { esperaDecision } from "@/lib/mantenimiento/aprobacion";
import AprobacionesClient from "./AprobacionesClient";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";
import type { OrdenServicio } from "@/lib/mantenimiento/types";

export default async function AprobacionesPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const permisos = await permisosComprasActuales();

  const [{ data }, { data: os }] = await Promise.all([
    // Todo lo que espera decisión, de lo más viejo a lo más nuevo: el cliente
    // lo reordena por urgencia sin perder la antigüedad como desempate.
    supabase
      .from("compras_requerimientos")
      // `!empresa_id`: `compras_odoo_ordenes` abre un segundo camino hasta `empresas` (PGRST201).
      .select("*, compras_areas(nombre), empresas!empresa_id(nombre), proveedores(nombre), compras_ubicaciones(nombre)")
      .in("estado_aprobacion", ["PENDIENTE", "EN_REVISION"])
      .order("fecha", { ascending: true }),

    // Las órdenes de servicio que todavía no se aprobaron.
    //
    // Se filtra por la pestaña y no por el estado porque **estar en SERVICIOS
    // es no estar aprobada**: cada pestaña de área es un FILTER por
    // estado="APROBADO", así que una OS llega ahí si y sólo si alguien se lo
    // escribió. El estado, en cambio, viene vacío en casi todas.
    //
    // Sin paginar a propósito: son 11, y el filtro las acota a las que nunca
    // pasaron el FILTER, que es una cola que no crece sola.
    supabase
      .from("ordenes_servicio")
      .select("*, equipos(name, code), sectores(nombre)")
      .eq("sheets_tab", "SERVICIOS")
      .order("os_number", { ascending: true }),
  ]);

  // La regla completa, la misma que testea `aprobacion.test.ts`: la consulta
  // acota, esto decide. Lo que saca de más es lo ya denegado, que no es trabajo
  // pendiente de nadie.
  const ordenesServicio = ((os ?? []) as OrdenServicio[]).filter(esperaDecision);

  return (
    <AprobacionesClient
      pendientes={(data ?? []) as RequerimientoConRelaciones[]}
      ordenesServicio={ordenesServicio}
      puedeAprobar={permisos.puedeAprobar}
      puedeAprobarOS={permisos.puedeAprobarOS}
    />
  );
}
