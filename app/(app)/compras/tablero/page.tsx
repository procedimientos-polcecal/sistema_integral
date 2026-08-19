import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelComprasDe } from "@/lib/compras/auth";
import TableroClient from "./TableroClient";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";

export default async function TableroPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Todo lo aprobado que todavía no se recibió.
  const { data } = await supabase
    .from("compras_requerimientos")
    .select("*, compras_areas(nombre), empresas(nombre), proveedores(nombre), sectores(nombre), equipos(name, code)")
    .eq("estado_aprobacion", "APROBADA")
    .in("estado_compra", ["PARA_COMPRAR", "EN_COMPARATIVA", "PEDIDO"])
    .order("fecha", { ascending: true });

  const nivel = await nivelComprasDe(supabase, user.id);

  return (
    <TableroClient
      requerimientos={(data ?? []) as RequerimientoConRelaciones[]}
      canEdit={nivel === "edicion" || nivel === "admin"}
    />
  );
}
