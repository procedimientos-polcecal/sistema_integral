import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { traerTodo } from "@/lib/core/paginado";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import ProveedoresClient from "./ProveedoresClient";
import type { Proveedor } from "@/lib/compras/types";

export default async function ProveedoresPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const { data: proveedores } = await supabase.from("proveedores").select("*").order("nombre");

  // Compras y monto por proveedor, para ordenar por relevancia real.
  // Paginado: sin esto el volumen se calculaba sobre 1000 RI.
  const compras = await traerTodo<{ proveedor_id: string; costo_iva: number | null; costo_envio: number | null }>(
    (desde, hasta) =>
      supabase
        .from("compras_requerimientos")
        .select("proveedor_id, costo_iva, costo_envio")
        .not("proveedor_id", "is", null)
        .range(desde, hasta)
  );

  const estadisticas: Record<string, { pedidos: number; monto: number }> = {};
  for (const c of compras) {
    const id = c.proveedor_id as string;
    const previo = estadisticas[id] ?? { pedidos: 0, monto: 0 };
    estadisticas[id] = {
      pedidos: previo.pedidos + 1,
      monto: previo.monto + (c.costo_iva ?? 0) + (c.costo_envio ?? 0),
    };
  }

  const { nivel } = await permisosComprasActuales();

  return (
    <ProveedoresClient
      proveedores={(proveedores ?? []) as Proveedor[]}
      estadisticas={estadisticas}
      canEdit={nivel === "edicion" || nivel === "admin"}
    />
  );
}
