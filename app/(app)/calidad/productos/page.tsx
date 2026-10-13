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
  if (!(await esAdminCalidad(supabase, user.id))) redirect("/calidad/carbonilla");

  const [productos, bandeja] = await Promise.all([
    traerProductosDeOdoo(supabase),
    traerBandeja(supabase),
  ]);

  // La lista de "sin resolver" perdió su fuente el 13/10/2026: la bandeja pasó
  // a ser de filas de la planilla, y Odoo ya no crea movimientos. Un producto
  // sin resolver ahora se ve en la conciliación, que es donde Odoo se mira.
  return <ProductosClient productos={productos} sinResolver={[]} />;
}
