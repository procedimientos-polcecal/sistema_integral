import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import type { EmpresaDelGrupo, ProveedorDelPadron } from "./altaDeFactura";
import type { ClaveNatural } from "./comprobante";
import type { FacturaProveedor } from "./types";

/**
 * Las consultas del buzón, en un solo lugar: las usa la pantalla y las usa la
 * ruta que carga, y las dos tienen que mirar lo mismo.
 */

/**
 * Los dos catálogos con los que se resuelven el emisor y el receptor del QR.
 *
 * Los proveedores van paginados con `traerTodo`: hoy son 291 y PostgREST corta
 * en 1000 sin avisar. "Esta tabla es chica" es el razonamiento que dejó el
 * tablero de Compras mostrando 1000 de 1900 filas.
 */
export async function traerCatalogos(supabase: SupabaseClient): Promise<{
  empresas: EmpresaDelGrupo[];
  proveedores: ProveedorDelPadron[];
}> {
  const [{ data: empresas }, proveedores] = await Promise.all([
    supabase.from("empresas").select("id, nombre, cuit").eq("activo", true).order("nombre"),
    traerTodo<ProveedorDelPadron>((desde, hasta) =>
      supabase
        .from("proveedores")
        .select("id, nombre, cuit")
        .eq("activo", true)
        .order("nombre")
        .range(desde, hasta)
    ),
  ]);

  return { empresas: (empresas ?? []) as EmpresaDelGrupo[], proveedores };
}

/**
 * La factura que ya está en el buzón con esta misma clave, si hay una.
 *
 * Es la consulta que evita el duplicado antes de subir el archivo: la misma
 * factura llega por mail y en papel, o la cargan dos personas el mismo día, y
 * eso es cuestión de tiempo con ~19 por día entrando por tres vías.
 */
export async function facturaConLaMismaClave(
  supabase: SupabaseClient,
  clave: ClaveNatural
): Promise<FacturaProveedor | null> {
  const { data } = await supabase
    .from("facturas_proveedor")
    .select("*")
    .eq("cuit_emisor", clave.cuit_emisor)
    .eq("tipo_comprobante", clave.tipo_comprobante)
    .eq("punto_venta", clave.punto_venta)
    .eq("numero", clave.numero)
    .maybeSingle();

  return (data as FacturaProveedor | null) ?? null;
}

/**
 * El buzón, ordenado por lo último que llegó.
 *
 * Los embeds nombran la FK a mano —`empresas!empresa_id`— porque
 * `facturas_proveedor` tiene FK a empresas, proveedores y
 * compras_requerimientos a la vez y sin nombrarla PostgREST contesta `PGRST201`
 * en vez de elegir un camino. Es lo mismo que rompió el listado de Compras
 * cuando entró `compras_odoo_ordenes`.
 */
export async function traerElBuzon(
  supabase: SupabaseClient,
  filtros: { estado?: string | null } = {}
) {
  let consulta = supabase
    .from("facturas_proveedor")
    .select(
      "*, empresas!empresa_id(nombre), proveedores!proveedor_id(nombre), compras_requerimientos!requerimiento_id(nro_ri)"
    )
    .order("created_at", { ascending: false })
    .limit(300);

  if (filtros.estado) consulta = consulta.eq("estado", filtros.estado);

  const { data, error } = await consulta;
  if (error) throw new Error(error.message);
  return data ?? [];
}
