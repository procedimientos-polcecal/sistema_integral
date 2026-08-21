import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelComprasDe } from "@/lib/compras/auth";
import { COLUMNAS_TABLERO } from "@/lib/compras/constants";
import { traerTodo } from "@/lib/core/paginado";
import { costosParaElPedido } from "@/lib/compras/comparativa";
import TableroClient from "./TableroClient";
import type { ResumenComparativa } from "./TableroClient";
import type { RequerimientoConRelaciones } from "@/lib/compras/types";

export default async function TableroPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Todo lo aprobado que todavía no se recibió.
  const { data } = await supabase
    .from("compras_requerimientos")
    .select("*, compras_areas(nombre), empresas(nombre), proveedores(nombre), compras_ubicaciones(nombre)")
    .eq("estado_aprobacion", "APROBADA")
    .in("estado_compra", COLUMNAS_TABLERO)
    .order("fecha", { ascending: true });

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

  // Con qué comparativa cuenta cada RI del tablero.
  //
  // El tablero lo necesita para dos cosas: no exigir el link cuando ya hay
  // presupuestos cargados, y mostrar de antemano con qué proveedor y qué costo
  // va a quedar el pedido. El `in` es sobre los RI del tablero, que es una cola
  // de trabajo y por lo tanto acotada.
  const ids = (data ?? []).map((r) => r.id as string);

  const cotizaciones = ids.length === 0 ? [] : await traerTodo<{
    requerimiento_id: string;
    elegida: boolean;
    proveedor_id: string;
    precio_total: number | null;
    costo_envio: number | null;
  }>((desde, hasta) =>
    supabase
      .from("compras_cotizaciones")
      .select("requerimiento_id, elegida, proveedor_id, precio_total, costo_envio")
      .in("requerimiento_id", ids)
      .range(desde, hasta)
  );

  // El nombre sale de la lista de proveedores que la página ya trae, en vez de
  // pedirlo otra vez en el select de las cotizaciones.
  const nombrePorProveedor = new Map(
    (proveedores ?? []).map((p) => [p.id as string, p.nombre as string])
  );

  const resumen: Record<string, ResumenComparativa> = {};
  for (const id of ids) resumen[id] = { cuantos: 0, elegida: null };

  for (const c of cotizaciones) {
    const r = resumen[c.requerimiento_id];
    if (!r) continue;
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
      requerimientos={(data ?? []) as RequerimientoConRelaciones[]}
      aprobadores={aprobadores}
      proveedores={proveedores ?? []}
      usuarioId={user.id}
      canEdit={nivel === "edicion" || nivel === "admin"}
      resumen={resumen}
    />
  );
}
