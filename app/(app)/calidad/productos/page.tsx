import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { esAdminCalidad } from "@/lib/calidad/auth";
import { traerBandeja, traerProductosDeOdoo } from "@/lib/calidad/consultas";
import ProductosClient from "./ProductosClient";

/**
 * La lista blanca: qué producto de Odoo cuenta como carbonilla.
 *
 * Sin esto, los seis fletes por mes de LA INVENCIBLE se sumarían al stock como
 * si fueran toneladas de carbón, y no se notaría hasta el conteo físico.
 */
export default async function ProductosPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");
  if (!(await esAdminCalidad(supabase, user.id))) redirect("/calidad");

  const [productos, bandeja] = await Promise.all([
    traerProductosDeOdoo(supabase),
    traerBandeja(supabase),
  ]);

  const resueltos = new Set(productos.map((p) => p.odoo_product_id));
  const sinResolver = [
    ...new Map(
      bandeja
        .filter((l) => !resueltos.has(l.odoo_product_id))
        .map((l) => [
          l.odoo_product_id,
          { odoo_product_id: l.odoo_product_id, odoo_product_nombre: l.odoo_product_nombre },
        ])
    ).values(),
  ];

  return <ProductosClient productos={productos} sinResolver={sinResolver} />;
}
