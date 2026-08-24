import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelComprasDe } from "@/lib/compras/auth";
import {
  ESTADOS_EN_CURSO, DIAS_DE_PEDIDO, ESTADOS_QUE_PIDEN_DATOS,
} from "@/lib/compras/constants";
import { traerTodo } from "@/lib/core/paginado";
import { costosParaElPedido } from "@/lib/compras/comparativa";
import TableroClient from "./TableroClient";
import type { ResumenComparativa } from "./TableroClient";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";

export default async function TableroPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // El trabajo en curso: todo lo que todavía no llegó a PEDIDO.
  //
  // Va paginado. Sin paginar, PostgREST corta en 1000 y no avisa: el tablero
  // mostraba los 1000 RI más VIEJOS —llegaba hasta abril— y no mostraba nada
  // posterior, porque 977 de esos 1000 lugares se los llevaba PEDIDO.
  const enCurso = await traerTodo<RequerimientoConRelaciones>((desde, hasta) =>
    supabase
      .from("compras_requerimientos")
      .select("*, compras_areas(nombre), empresas(nombre), proveedores(nombre), compras_ubicaciones(nombre)")
      .eq("estado_aprobacion", "APROBADA")
      .in("estado_compra", ESTADOS_EN_CURSO)
      .order("fecha", { ascending: true })
      .range(desde, hasta)
  );

  // De lo ya pedido, sólo lo reciente.
  //
  // La columna PEDIDO acumula el histórico entero porque nada lo pasa a
  // RECIBIDO todavía: son más de 1600 pedidos cerrados que no son trabajo en
  // curso. Traerlos hace del tablero un archivo en vez de un tablero. Lo que
  // queda afuera se dice en pantalla, no se esconde.
  const corte = new Date();
  corte.setDate(corte.getDate() - DIAS_DE_PEDIDO);
  const desdeISO = corte.toISOString().slice(0, 10);

  const pedidos = await traerTodo<RequerimientoConRelaciones>((desde, hasta) =>
    supabase
      .from("compras_requerimientos")
      .select("*, compras_areas(nombre), empresas(nombre), proveedores(nombre), compras_ubicaciones(nombre)")
      .eq("estado_aprobacion", "APROBADA")
      .eq("estado_compra", "PEDIDO")
      .gte("fecha", desdeISO)
      .order("fecha", { ascending: true })
      .range(desde, hasta)
  );

  const { count: pedidosViejos } = await supabase
    .from("compras_requerimientos")
    .select("id", { count: "exact", head: true })
    .eq("estado_aprobacion", "APROBADA")
    .eq("estado_compra", "PEDIDO")
    .lt("fecha", desdeISO);

  const data = [...enCurso, ...pedidos];

  const [nivel, { data: grants }, { data: alias }, { data: proveedores }] = await Promise.all([
    nivelComprasDe(supabase, user.id),
    // Quiénes pueden aprobar una compra: los mismos que aprueban los RI.
    supabase
      .from("usuario_modulos")
      .select("usuarios(id, nombre, apellido)")
      .eq("modulo", "compras")
      .eq("nivel", "admin"),
    // El alias es como se los nombra en la planilla: NICO, MAXI.
    supabase.from("compras_aprobadores").select("usuario_id, alias_planilla"),
    supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre"),
  ]);

  // Con qué comparativa cuenta cada RI.
  //
  // El diálogo del tablero lo usa para dos cosas: no exigir el link cuando ya
  // hay presupuestos cargados, y mostrar de antemano con qué proveedor y qué
  // costo va a quedar el pedido.
  //
  // El filtro va por el ESTADO del requerimiento y no por una lista de ids.
  // Mandar los ids parecía razonable —"el tablero es una cola de trabajo"— pero
  // el tablero arrastra todo el histórico: son 1767 RI, y una lista así arma una
  // URL de 37 KB que PostgREST rechaza con 400. Filtrando por estado la consulta
  // queda acotada por construcción, sin depender de cuántos RI haya.
  const cotizaciones = await traerTodo<{
    requerimiento_id: string;
    elegida: boolean;
    proveedor_id: string;
    precio_total: number | null;
    costo_envio: number | null;
  }>((desde, hasta) =>
    supabase
      .from("compras_cotizaciones")
      .select(
        "requerimiento_id, elegida, proveedor_id, precio_total, costo_envio, compras_requerimientos!inner(estado_compra)"
      )
      .in("compras_requerimientos.estado_compra", ESTADOS_QUE_PIDEN_DATOS)
      .range(desde, hasta)
  );

  // El nombre sale de la lista de proveedores que la página ya trae, en vez de
  // pedirlo otra vez en el select de las cotizaciones.
  const nombrePorProveedor = new Map(
    (proveedores ?? []).map((p) => [p.id as string, p.nombre as string])
  );

  // Sólo entran los RI que tienen alguna cotización; el resto lo resuelve el
  // valor por defecto donde se lo usa.
  const resumen: Record<string, ResumenComparativa> = {};

  for (const c of cotizaciones) {
    const r = (resumen[c.requerimiento_id] ??= { cuantos: 0, elegida: null });
    r.cuantos += 1;
    if (c.elegida) {
      r.elegida = {
        ...costosParaElPedido(c),
        proveedor_nombre: nombrePorProveedor.get(c.proveedor_id) ?? null,
      };
    }
  }

  const aliasPorUsuario = Object.fromEntries(
    (alias ?? []).map((a) => [a.usuario_id as string, a.alias_planilla as string])
  );

  const aprobadores = (grants ?? [])
    .map((g) => g.usuarios as unknown as { id: string; nombre: string; apellido: string } | null)
    .filter((u): u is { id: string; nombre: string; apellido: string } => Boolean(u))
    .map((u) => ({ ...u, alias: aliasPorUsuario[u.id] ?? null }));

  return (
    <TableroClient
      requerimientos={data}
      aprobadores={aprobadores}
      proveedores={proveedores ?? []}
      usuarioId={user.id}
      canEdit={nivel === "edicion" || nivel === "admin"}
      resumen={resumen}
      pedidosViejos={pedidosViejos ?? 0}
      diasDePedido={DIAS_DE_PEDIDO}
    />
  );
}
