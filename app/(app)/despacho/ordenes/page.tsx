import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelDespachoDe } from "@/lib/despacho/auth";
import { traerMapeoDeProductos, traerOrdenes } from "@/lib/despacho/consultas";
import { clasificacionDeLaOrden, textoDeClasificacion } from "@/lib/despacho/clasificacion";
import { estadoDeLaOrden, tiemposDeLaOrden } from "@/lib/despacho/orden";
import { indicadoresDeOrdenes, type Indicadores } from "@/lib/despacho/indicadores";
import { leerFiltrosDelHistorico, type FiltrosDeHistorico } from "@/lib/despacho/filtrosUrl";
import type { EstadoDeOrden, OrdenDeCarga } from "@/lib/despacho/types";
import OrdenesClient from "./OrdenesClient";

/**
 * El histórico de órdenes de carga, con los números que la planilla no da.
 *
 * `material` y `envase` se filtran **en memoria** y no en la consulta: no son
 * columnas de la orden, viven en el mapeo de productos. Un join sobre
 * `odoo_product_id` no existe porque no es una FK — y no lo es a propósito: una
 * orden puede tener un producto que nadie mapeó todavía, y una FK la rechazaría
 * en vez de dejarla entrar sin clasificar.
 */

export interface FilaDeHistorico {
  orden: OrdenDeCarga;
  estado: EstadoDeOrden;
  producto: string;
  sinClasificar: boolean;
  minutosDeCarga: number | null;
  minutosEnPredio: number | null;
}

export interface DatosDelHistorico {
  filas: FilaDeHistorico[];
  indicadores: Indicadores;
  filtros: FiltrosDeHistorico;
  empresas: { id: string; nombre: string }[];
}

export default async function HistoricoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const crudos = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(crudos)) {
    if (typeof v === "string") params.set(k, v);
    else if (Array.isArray(v) && v[0] !== undefined) params.set(k, v[0]);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelDespachoDe(supabase, user.id);
  if (!nivel) redirect("/");

  const { data: empresasCrudas } = await supabase
    .from("empresas")
    .select("id, nombre")
    .order("nombre");
  const empresas = (empresasCrudas ?? []) as { id: string; nombre: string }[];

  const filtros = leerFiltrosDelHistorico(params, empresas.map((e) => e.nombre));

  const [mapeo, ordenes] = await Promise.all([
    traerMapeoDeProductos(supabase),
    traerOrdenes(supabase, {
      desde: filtros.desde || undefined,
      hasta: filtros.hasta || undefined,
      cliente: filtros.cliente || undefined,
      empresaId: empresas.find((e) => e.nombre === filtros.empresa)?.id,
    }),
  ]);

  const filas: FilaDeHistorico[] = [];
  for (const orden of ordenes) {
    const clasificacion = clasificacionDeLaOrden(orden, mapeo);

    // Los filtros de material y envase sacan lo que no clasifica: pedir "todo lo
    // que salió a granel" y recibir además lo que nadie mapeó sería contestar
    // otra pregunta.
    if (filtros.material && clasificacion?.material !== filtros.material) continue;
    if (filtros.envase && clasificacion?.envase !== filtros.envase) continue;

    const tiempos = tiemposDeLaOrden(orden);
    filas.push({
      orden,
      estado: estadoDeLaOrden(orden),
      producto: clasificacion
        ? textoDeClasificacion(clasificacion)
        : (orden.producto_raw ?? "—"),
      sinClasificar: clasificacion === null,
      minutosDeCarga: tiempos.carga,
      minutosEnPredio: tiempos.predio,
    });
  }

  return (
    <OrdenesClient
      datos={{
        filas,
        indicadores: indicadoresDeOrdenes(filas.map((f) => f.orden)),
        filtros,
        empresas,
      }}
    />
  );
}
