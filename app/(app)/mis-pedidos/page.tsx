import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MisPedidosClient from "./MisPedidosClient";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";

/**
 * Fuera del módulo Compras a propósito: cualquier usuario del sistema puede
 * pedir un material y seguir sus propios pedidos, aunque no trabaje en Compras.
 */
export default async function MisPedidosPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: pedidos }, { data: areas }, { data: empresas }, { data: sectores }, { data: equipos }] =
    await Promise.all([
      supabase
        .from("compras_requerimientos")
        .select("*, compras_areas(nombre), empresas(nombre), proveedores(nombre), sectores(nombre), equipos(name, code)")
        .eq("solicitante_id", user.id)
        .order("nro_ri", { ascending: false }),
      supabase.from("compras_areas").select("id, nombre").eq("activo", true).order("orden"),
      supabase.from("empresas").select("id, nombre").order("nombre"),
      supabase.from("sectores").select("id, nombre").eq("activo", true).order("nombre"),
      supabase.from("equipos").select("id, name, code").eq("is_active", true).order("code"),
    ]);

  return (
    <MisPedidosClient
      pedidos={(pedidos ?? []) as RequerimientoConRelaciones[]}
      areas={areas ?? []}
      empresas={empresas ?? []}
      sectores={sectores ?? []}
      equipos={equipos ?? []}
    />
  );
}
