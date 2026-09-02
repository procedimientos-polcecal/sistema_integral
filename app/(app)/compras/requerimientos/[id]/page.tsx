import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { permisosComprasDe, aprobadoresDeCompras } from "@/lib/compras/auth";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import { cotizacionDeHoy } from "@/lib/compras/dolar";
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
    // Con los datos de pago: el formulario de presupuesto los completa solo
    // al elegir el proveedor.
    supabase
      .from("proveedores")
      .select("id, nombre, plazo_pago_dias, forma_pago, condicion_pago")
      .eq("activo", true)
      .order("nombre"),
  ]);

  const { data: empresas } = await supabase.from("empresas").select("id, nombre").order("nombre");

  // Quiénes pueden aprobar una compra: es a uno de ellos a quien Compras se
  // la asigna.
  const aprobadores = await aprobadoresDeCompras(supabase);

  const permisos = await permisosComprasActuales();

  // La cotización del día, para convertir los presupuestos que vinieron en
  // dólares. Puede ser null: la pantalla lo dice en vez de inventar un número.
  const dolar = await cotizacionDeHoy();

  // Aprobar la compra es de quien la tiene asignada: la comparativa le
  // ofrece elegir solo a esa persona.
  const esAsignado = requerimiento.compra_asignada_a === user.id;

  // Lo que el pañol registró contra este RI. Se consulta siempre: si Inventario
  // todavía no está en marcha la lista viene vacía y la sección no se muestra,
  // que es lo mismo que no haber preguntado.
  const { data: entradasAlPanol } = await supabase
    .from("inventario_movimientos")
    .select("id, codigo, cantidad, fecha, inventario_articulos(descripcion)")
    .eq("requerimiento_id", id)
    .eq("tipo", "entrada")
    .order("fecha", { ascending: false });

  return (
    <RequerimientoDetalle
      dolar={dolar}
      requerimiento={requerimiento as RequerimientoConRelaciones}
      historial={(historial ?? []) as HistorialItem[]}
      cotizaciones={(cotizaciones ?? []) as Cotizacion[]}
      proveedores={proveedores ?? []}
      empresas={empresas ?? []}
      puedeEditar={permisos.puedeEditar}
      puedeAprobar={permisos.puedeAprobar}
      esAsignado={esAsignado}
      aprobadores={aprobadores}
      entradasAlPanol={(entradasAlPanol ?? []).map((e) => ({
        id: e.id as string,
        codigo: e.codigo as string | null,
        // El embed llega como objeto o como arreglo según cómo esté declarada
        // la relación, igual que en `empresaDelSector`. Se aceptan las dos.
        descripcion: descripcionDelArticulo(e.inventario_articulos),
        cantidad: Number(e.cantidad),
        fecha: e.fecha as string | null,
      }))}
    />
  );
}

/** La descripción del artículo, venga el embed como objeto o como arreglo. */
function descripcionDelArticulo(embed: unknown): string | null {
  const uno = Array.isArray(embed) ? embed[0] : embed;
  return (uno as { descripcion?: string } | null)?.descripcion ?? null;
}
