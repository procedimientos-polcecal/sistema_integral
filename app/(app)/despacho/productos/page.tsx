import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelDespachoDe } from "@/lib/despacho/auth";
import {
  productosUsadosEnOrdenes,
  traerMapeoDeProductos,
} from "@/lib/despacho/consultas";
import type { ProductoDeDespacho } from "@/lib/despacho/types";
import ProductosClient from "./ProductosClient";

/**
 * El mapeo de productos: qué material, granulometría y envase es cada producto
 * de Odoo.
 *
 * Es la pantalla de trabajo de un admin, y su lista de pendientes son los
 * productos **que ya aparecieron en órdenes y nadie clasificó**, ordenados por
 * cuántas órdenes los usaron. Mapear los primeros cinco cubre casi todo el
 * volumen; listar los 432 productos de Odoo dejaría el trabajo real perdido en
 * el medio.
 */

export interface SinClasificar {
  odoo_product_id: number | null;
  producto_raw: string | null;
  ordenes: number;
}

export default async function MapeoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelDespachoDe(supabase, user.id);
  if (!nivel) redirect("/");
  // El nav ya lo marca `soloAdmin`, pero un enlace pegado a mano llega igual: sin
  // esto la pantalla se abre y RLS devuelve el error al guardar, que es peor.
  if (nivel !== "admin") redirect("/despacho");

  const [mapeo, usados, productosDeProduccion] = await Promise.all([
    traerMapeoDeProductos(supabase),
    productosUsadosEnOrdenes(supabase),
    // Para el puente con el catálogo de fábrica. Es opcional: el granel quedó
    // afuera de Producción a propósito y no tiene fila allá.
    supabase.from("produccion_productos").select("id, nombre").order("orden"),
  ]);

  const mapeados = new Set(mapeo.map((m) => m.odoo_product_id));

  return (
    <ProductosClient
      mapeo={mapeo as ProductoDeDespacho[]}
      sinClasificar={usados.filter(
        (u) => u.odoo_product_id === null || !mapeados.has(u.odoo_product_id)
      )}
      productosDeProduccion={(productosDeProduccion.data ?? []) as { id: string; nombre: string }[]}
    />
  );
}
