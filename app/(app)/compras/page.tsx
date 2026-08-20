import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/core/paginado";
import DashboardClient from "./DashboardClient";

export default async function ComprasDashboardPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  /** Cuenta sin traer filas: sólo el count del servidor. */
  const base = () => supabase.from("compras_requerimientos").select("id", { count: "exact", head: true });

  const [total, pendientes, paraComprar, enComparativa, pedidos, urgentes] = await Promise.all([
    base(),
    base().in("estado_aprobacion", ["PENDIENTE", "EN_REVISION"]),
    base().eq("estado_aprobacion", "APROBADA").eq("estado_compra", "PARA_COMPRAR"),
    base().eq("estado_aprobacion", "APROBADA").eq("estado_compra", "EN_COMPARATIVA"),
    base().eq("estado_compra", "PEDIDO"),
    base().eq("prioridad", "URGENTE").in("estado_compra", ["PARA_COMPRAR", "EN_COMPARATIVA", "PEDIDO"]),
  ]);

  // Para los gráficos sólo se traen las columnas necesarias de lo que tiene costo.
  // Paginado: con .limit(3000) PostgREST devolvía 1000 igual, así que el gasto
  // total y los gráficos salían subestimados sin que nada lo indicara.
  const conCosto = await traerTodo<Record<string, unknown>>((desde, hasta) =>
    supabase
      .from("compras_requerimientos")
      .select("fecha, costo_iva, costo_envio, empresas(nombre), compras_areas(nombre), proveedores(nombre)")
      .not("costo_iva", "is", null)
      .order("fecha", { ascending: false })
      .range(desde, hasta)
  );

  const { data: recientes } = await supabase
    .from("compras_requerimientos")
    .select("id, nro_ri, descripcion, fecha, prioridad, estado_aprobacion, estado_compra, compras_areas(nombre)")
    .order("nro_ri", { ascending: false })
    .limit(8);

  return (
    <DashboardClient
      contadores={{
        total: total.count ?? 0,
        pendientes: pendientes.count ?? 0,
        paraComprar: paraComprar.count ?? 0,
        enComparativa: enComparativa.count ?? 0,
        pedidos: pedidos.count ?? 0,
        urgentes: urgentes.count ?? 0,
      }}
      conCosto={conCosto as never[]}
      recientes={(recientes ?? []) as never[]}
    />
  );
}
