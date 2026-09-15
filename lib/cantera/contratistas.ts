import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Quiénes son los contratistas de cantera, resueltos a sus partners de Odoo.
 *
 * `cantera_contratistas` es sólo la lista de `proveedor_id` (hoy Canobe y,
 * cuando se cargue, Voladuras Olavarría) — sin rol: confirmado con el usuario
 * que cualquiera de los dos factura cualquier etapa. El cruce con Odoo es
 * siempre por CUIT, nunca por nombre; acá ya viene resuelto por
 * `proveedores_odoo`, que es donde vive ese cruce.
 */

export interface ContratistaResuelto {
  proveedorId: string;
  nombre: string;
  /** Sus partners de Odoo, uno por empresa en la que factura (hasta 2). */
  partnerIds: number[];
}

export interface ContratistasDeCantera {
  resueltos: ContratistaResuelto[];
  /** Contratistas en la lista que todavía no tienen enlace en `proveedores_odoo`. */
  sinEnlace: { proveedorId: string; nombre: string }[];
}

export async function contratistasDeCantera(
  supabase: SupabaseClient
): Promise<ContratistasDeCantera> {
  const { data: contratistas, error } = await supabase
    .from("cantera_contratistas")
    .select("proveedor_id, proveedores!proveedor_id(nombre)");
  if (error) throw new Error(error.message);

  const filas = (contratistas ?? []) as unknown as {
    proveedor_id: string;
    proveedores: { nombre: string } | { nombre: string }[] | null;
  }[];

  const resueltos: ContratistaResuelto[] = [];
  const sinEnlace: { proveedorId: string; nombre: string }[] = [];

  for (const c of filas) {
    const prov = Array.isArray(c.proveedores) ? c.proveedores[0] : c.proveedores;
    const nombre = prov?.nombre ?? "(proveedor sin nombre)";

    const { data: enlaces, error: errEnlaces } = await supabase
      .from("proveedores_odoo")
      .select("odoo_partner_id")
      .eq("proveedor_id", c.proveedor_id);
    if (errEnlaces) throw new Error(errEnlaces.message);

    const partnerIds = (enlaces ?? []).map((e) => e.odoo_partner_id as number);
    if (partnerIds.length === 0) sinEnlace.push({ proveedorId: c.proveedor_id, nombre });
    else resueltos.push({ proveedorId: c.proveedor_id, nombre, partnerIds });
  }

  return { resueltos, sinEnlace };
}

/** Todos los partner ids de Odoo de todos los contratistas juntos, para el picker de facturas. */
export function todosLosPartnerIds(c: ContratistasDeCantera): number[] {
  return c.resueltos.flatMap((r) => r.partnerIds);
}
