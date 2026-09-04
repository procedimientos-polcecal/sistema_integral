import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { traerTodo } from "@/lib/core/paginado";
import DashboardClient from "./DashboardClient";

export default async function ComprasDashboardPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  /** Cuenta sin traer filas: sólo el count del servidor. */
  const base = () => supabase.from("compras_requerimientos").select("id", { count: "exact", head: true });

  const [total, pendientes, paraComprar, enComparativa, pedidos, urgentes] = await Promise.all([
    base(),
    base().in("estado_aprobacion", ["PENDIENTE", "EN_REVISION"]),
    base().eq("estado_aprobacion", "APROBADA").eq("estado_compra", "PARA_COMPRAR"),
    base().eq("estado_aprobacion", "APROBADA").eq("estado_compra", "EN_COMPARATIVA"),
    base().eq("estado_compra", "PEDIDO"),
    // Todo lo urgente que todavía no se pidió: el circuito completo desde que
    // entra hasta que se registra el pedido.
    //
    // Sin los pedidos, que eran 1.171 de los 1.185 que mostraba antes. Eso no es
    // trabajo urgente pendiente sino el arrastre de pedidos que se marcaron como
    // pedidos y nunca como recibidos —lo mismo de lo que avisa el cartel de
    // pedidos viejos del tablero—, y con ese número adentro la cifra no servía
    // para decidir nada.
    //
    // Los cuatro estados van enteros y no los dos del medio: la lista original
    // salteaba SIN_INICIAR y APROBADO, así que un urgente que nadie había
    // empezado no figuraba, y otro desaparecía del contador justo cuando le
    // aprobaban la compra para reaparecer al registrarse el pedido. Un hueco en
    // el medio de un circuito no se nota nunca desde el dashboard.
    //
    // EN_ESPERA queda afuera a propósito: es un pedido frenado por decisión de
    // alguien, no algo que esté esperando que Compras lo mueva.
    base()
      .eq("prioridad", "URGENTE")
      .in("estado_compra", ["SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO"]),
  ]);

  // Para los gráficos sólo se traen las columnas necesarias de lo que tiene costo.
  // Paginado: con .limit(3000) PostgREST devolvía 1000 igual, así que el gasto
  // total y los gráficos salían subestimados sin que nada lo indicara.
  const conCosto = await traerTodo<Record<string, unknown>>((desde, hasta) =>
    supabase
      .from("compras_requerimientos")
      // `!empresa_id`: `compras_odoo_ordenes` abre un segundo camino hasta `empresas` (PGRST201).
      .select("fecha, costo_iva, costo_envio, empresas!empresa_id(nombre), compras_areas(nombre), proveedores(nombre)")
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
