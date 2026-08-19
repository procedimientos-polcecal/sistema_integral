import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelComprasDe } from "@/lib/compras/auth";
import ProveedoresClient from "./ProveedoresClient";
import type { Proveedor } from "@/lib/compras/types";

export default async function ProveedoresPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: proveedores }, { data: compras }] = await Promise.all([
    supabase.from("proveedores").select("*").order("nombre"),
    // Compras y monto por proveedor, para ordenar por relevancia real.
    supabase
      .from("compras_requerimientos")
      .select("proveedor_id, costo_iva, costo_envio")
      .not("proveedor_id", "is", null),
  ]);

  const estadisticas: Record<string, { pedidos: number; monto: number }> = {};
  for (const c of compras ?? []) {
    const id = c.proveedor_id as string;
    const previo = estadisticas[id] ?? { pedidos: 0, monto: 0 };
    estadisticas[id] = {
      pedidos: previo.pedidos + 1,
      monto: previo.monto + (c.costo_iva ?? 0) + (c.costo_envio ?? 0),
    };
  }

  const nivel = await nivelComprasDe(supabase, user.id);

  return (
    <ProveedoresClient
      proveedores={(proveedores ?? []) as Proveedor[]}
      estadisticas={estadisticas}
      canEdit={nivel === "edicion" || nivel === "admin"}
    />
  );
}
