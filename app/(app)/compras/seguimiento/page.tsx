import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import { traerTodo } from "@/lib/core/paginado";
import SeguimientoClient from "./SeguimientoClient";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";

export default async function SeguimientoPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const { puedeEditar } = await permisosComprasActuales();
  if (!puedeEditar) redirect("/compras");

  // Los dos estados en una sola consulta: son la misma pantalla y traerlos por
  // separado duplica el viaje. `traerTodo` porque los recibidos son ~1.700.
  const requerimientos = await traerTodo<RequerimientoConRelaciones>((desde, hasta) =>
    supabase
      .from("compras_requerimientos")
      // `!empresa_id`: `compras_odoo_ordenes` abre un segundo camino hasta `empresas` (PGRST201).
      .select("*, compras_areas(nombre), empresas!empresa_id(nombre), proveedores!proveedor_id(nombre)")
      .in("estado_compra", ["PEDIDO", "RECIBIDO"])
      .order("fecha_pedido", { ascending: false, nullsFirst: false })
      .range(desde, hasta)
  );

  return <SeguimientoClient requerimientos={requerimientos} />;
}
