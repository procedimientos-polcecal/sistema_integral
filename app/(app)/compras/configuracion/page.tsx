import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosComprasDe } from "@/lib/compras/auth";
import ConfiguracionClient from "./ConfiguracionClient";
import type { Sincronizacion } from "@/lib/compras/types";

export default async function ConfiguracionPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosComprasDe(supabase, user.id);
  if (!permisos.puedeEditar) redirect("/compras");

  const [{ data: sincronizaciones }, { count: gestionados }, { count: total }] = await Promise.all([
    supabase.from("compras_sincronizaciones").select("*").order("created_at", { ascending: false }).limit(10),
    supabase.from("compras_requerimientos").select("id", { count: "exact", head: true }).eq("editado_en_app", true),
    supabase.from("compras_requerimientos").select("id", { count: "exact", head: true }),
  ]);

  return (
    <ConfiguracionClient
      sincronizaciones={(sincronizaciones ?? []) as Sincronizacion[]}
      gestionadosEnApp={gestionados ?? 0}
      total={total ?? 0}
    />
  );
}
