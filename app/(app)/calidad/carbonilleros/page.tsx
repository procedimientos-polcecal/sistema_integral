import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { esAdminCalidad } from "@/lib/calidad/auth";
import { traerBandeja, traerCarbonilleros } from "@/lib/calidad/consultas";
import { traerTodo } from "@/lib/core/paginado";
import CarbonillerosClient from "./CarbonillerosClient";

/**
 * Qué proveedor de Odoo es carbonillero, y de qué tipo.
 *
 * **Es el único lugar donde se dice el tipo de carbón**, porque no se puede
 * deducir de ningún lado: Membranex —el único residual— factura con el mismo
 * producto que los vegetales seis veces al año.
 */
export default async function CarbonillerosPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");
  if (!(await esAdminCalidad(supabase, user.id))) redirect("/calidad");

  const [carbonilleros, bandeja, empresas, proveedores] = await Promise.all([
    traerCarbonilleros(supabase),
    traerBandeja(supabase),
    supabase.from("empresas").select("id, nombre").order("nombre"),
    traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
      supabase
        .from("proveedores")
        .select("id, nombre")
        .ilike("rubro", "%CARBONILLA%")
        .order("nombre")
        .range(desde, hasta)
    ),
  ]);

  // Los partners que aparecieron en la bandeja sin estar declarados: se dan de
  // alta desde acá, sin ir a buscar el id a Odoo.
  const declarados = new Set(carbonilleros.map((c) => c.odoo_partner_id));
  const sinDeclarar = [
    ...new Map(
      bandeja
        .filter((l) => !declarados.has(l.odoo_partner_id))
        .map((l) => [l.odoo_partner_id, { id: l.odoo_partner_id, nombre: l.odoo_partner_nombre }])
    ).values(),
  ];

  return (
    <CarbonillerosClient
      carbonilleros={carbonilleros}
      sinDeclarar={sinDeclarar}
      empresas={empresas.data ?? []}
      proveedores={proveedores}
    />
  );
}
