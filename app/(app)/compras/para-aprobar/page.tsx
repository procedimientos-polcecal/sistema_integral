import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { puedeAprobarCompras } from "@/lib/compras/auth";
import { traerTodo } from "@/lib/core/paginado";
import BandejaClient from "./BandejaClient";
import type { RequerimientoConRelaciones, Cotizacion } from "@/lib/compras/types";

export default async function ParaAprobarPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // La bandeja es de quienes aprueban: no tiene nada que mostrarle a nadie más.
  if (!(await puedeAprobarCompras(supabase, user.id))) redirect("/compras");

  const requerimientos = await traerTodo<RequerimientoConRelaciones>((desde, hasta) =>
    supabase
      .from("compras_requerimientos")
      .select("*, compras_areas(nombre), empresas(nombre), proveedores(nombre), compras_ubicaciones(nombre)")
      .eq("estado_aprobacion", "APROBADA")
      .eq("estado_compra", "PARA_COMPRAR")
      .order("fecha", { ascending: true })
      .range(desde, hasta)
  );

  // Los presupuestos de todos ellos, para poder decidir sin abrir cada ficha.
  //
  // El filtro va por el estado del requerimiento y no por una lista de ids:
  // mandar los ids arma una URL que PostgREST rechaza cuando el conjunto crece,
  // y ya nos tumbó el tablero una vez.
  //
  // El `as unknown as` no es pereza: cuando el select lleva un recurso embebido,
  // Supabase infiere `proveedores` como arreglo y choca con `Cotizacion`, que lo
  // declara como objeto. La forma real de la respuesta sí corresponde al tipo.
  const cotizaciones = (await traerTodo((desde, hasta) =>
    supabase
      .from("compras_cotizaciones")
      .select("*, proveedores(nombre), compras_requerimientos!inner(estado_compra)")
      .eq("compras_requerimientos.estado_compra", "PARA_COMPRAR")
      .order("precio_total", { ascending: true })
      .range(desde, hasta)
  )) as unknown as Cotizacion[];

  const porRequerimiento: Record<string, Cotizacion[]> = {};
  for (const c of cotizaciones) {
    (porRequerimiento[c.requerimiento_id] ??= []).push(c);
  }

  return (
    <BandejaClient
      requerimientos={requerimientos}
      cotizaciones={porRequerimiento}
      usuarioId={user.id}
    />
  );
}
