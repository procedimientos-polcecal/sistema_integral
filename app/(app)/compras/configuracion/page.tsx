import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosComprasDe, aprobadoresDeCompras } from "@/lib/compras/auth";
import ConfiguracionClient from "./ConfiguracionClient";
import type { Sincronizacion } from "@/lib/compras/types";

export default async function ConfiguracionPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosComprasDe(supabase, user.id);
  if (!permisos.puedeEditar) redirect("/compras");

  // La pregunta que importa es "¿ya puedo apagar la planilla?", y eso se
  // responde mirando por dónde entran los pedidos NUEVOS, no qué porcentaje del
  // histórico se tocó: los 1800 RI viejos ya están cerrados y nadie los va a
  // volver a gestionar acá, así que ese porcentaje nunca sube.
  const hace30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const cuenta = (f: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => f(base());
  function base() {
    return supabase.from("compras_requerimientos").select("id", { count: "exact", head: true });
  }

  const [
    { data: sincronizaciones },
    { count: nuevosApp },
    { count: nuevosPlanilla },
    { count: abiertos },
    { count: abiertosGestionados },
    { count: gestionados },
    { count: total },
  ] = await Promise.all([
    supabase.from("compras_sincronizaciones").select("*").order("created_at", { ascending: false }).limit(10),
    cuenta((q) => q.eq("origen", "app").gte("fecha", hace30)),
    cuenta((q) => q.neq("origen", "app").gte("fecha", hace30)),
    cuenta((q) => q.not("estado_compra", "in", "(RECIBIDO,DENEGADO)").neq("estado_aprobacion", "DENEGADA")),
    cuenta((q) =>
      q.not("estado_compra", "in", "(RECIBIDO,DENEGADO)").neq("estado_aprobacion", "DENEGADA").eq("editado_en_app", true)
    ),
    cuenta((q) => q.eq("editado_en_app", true)),
    cuenta((q) => q),
  ]);

  const aprobadores = await aprobadoresDeCompras(supabase);

  return (
    <ConfiguracionClient
      sincronizaciones={(sincronizaciones ?? []) as Sincronizacion[]}
      aprobadores={aprobadores}
      nuevosApp={nuevosApp ?? 0}
      nuevosPlanilla={nuevosPlanilla ?? 0}
      abiertos={abiertos ?? 0}
      abiertosGestionados={abiertosGestionados ?? 0}
      gestionados={gestionados ?? 0}
      total={total ?? 0}
    />
  );
}
