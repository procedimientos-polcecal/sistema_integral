import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosComprasDe } from "@/lib/compras/auth";
import RequerimientoDetalle from "./RequerimientoDetalle";
import type { RequerimientoConRelaciones, HistorialItem, Cotizacion } from "@/lib/compras/types";

export default async function RequerimientoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
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

  const permisos = await permisosComprasDe(supabase, user.id);

  return (
    <RequerimientoDetalle
      requerimiento={requerimiento as RequerimientoConRelaciones}
      historial={(historial ?? []) as HistorialItem[]}
      cotizaciones={(cotizaciones ?? []) as Cotizacion[]}
      proveedores={proveedores ?? []}
      puedeEditar={permisos.puedeEditar}
      puedeAprobar={permisos.puedeAprobar}
    />
  );
}
