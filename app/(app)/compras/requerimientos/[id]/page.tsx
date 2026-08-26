import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { permisosComprasDe, aprobadoresDeCompras } from "@/lib/compras/auth";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import RequerimientoDetalle from "./RequerimientoDetalle";
import type { RequerimientoConRelaciones, HistorialItem, Cotizacion } from "@/lib/compras/types";

export default async function RequerimientoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const { data: requerimiento } = await supabase
    .from("compras_requerimientos")
    .select("*, compras_areas(nombre), empresas(nombre), proveedores(nombre), compras_ubicaciones(nombre)")
    .eq("id", id)
    .single();

  if (!requerimiento) notFound();

  const [{ data: historial }, { data: cotizaciones }, { data: proveedores }] = await Promise.all([
    supabase
      .from("compras_historial")
      .select("*")
      .eq("requerimiento_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("compras_cotizaciones")
      .select("*, proveedores(nombre)")
      .eq("requerimiento_id", id)
      .order("precio_total", { ascending: true }),
    supabase.from("proveedores").select("id, nombre").eq("activo", true).order("nombre"),
  ]);

  const { data: empresas } = await supabase.from("empresas").select("id, nombre").order("nombre");

  // Quiénes pueden aprobar una compra: es a uno de ellos a quien Compras se
  // la asigna.
  const aprobadores = await aprobadoresDeCompras(supabase);

  const permisos = await permisosComprasActuales();

  // Aprobar la compra es de quien la tiene asignada: la comparativa le
  // ofrece elegir solo a esa persona.
  const esAsignado = requerimiento.compra_asignada_a === user.id;

  return (
    <RequerimientoDetalle
      requerimiento={requerimiento as RequerimientoConRelaciones}
      historial={(historial ?? []) as HistorialItem[]}
      cotizaciones={(cotizaciones ?? []) as Cotizacion[]}
      proveedores={proveedores ?? []}
      empresas={empresas ?? []}
      puedeEditar={permisos.puedeEditar}
      puedeAprobar={permisos.puedeAprobar}
      esAsignado={esAsignado}
      aprobadores={aprobadores}
    />
  );
}
