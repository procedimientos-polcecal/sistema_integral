import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { traerTodo } from "@/lib/core/paginado";
import type { CotizacionHistorica } from "@/lib/compras/buscadorDeComparativas";
import ComparativasClient from "./ComparativasClient";

/**
 * Lo que trae PostgREST por cada cotización, con el pedido y el proveedor
 * embebidos.
 *
 * El embed se probó contra la base antes de escribirlo —`compras_cotizaciones`
 * tiene un solo camino a cada una de las dos, así que no hace falta nombrar el
 * FK—, que es lo que pide la regla de los embeds ambiguos: un segundo camino
 * contesta 300 y no lo ve ni `tsc` ni la suite.
 */
type FilaCruda = {
  id: string;
  precio_unitario: number | null;
  precio_total: number | null;
  cantidad: number | null;
  unidad_medida: string | null;
  marca: string | null;
  moneda: string | null;
  condiciones_pago: string | null;
  disponibilidad: string | null;
  proveedores: { id: string; nombre: string } | null;
  compras_requerimientos: {
    id: string;
    nro_ri: number | null;
    descripcion: string | null;
    clave_articulo: string | null;
    fecha: string | null;
    comparativa_drive_id: string | null;
    comparativa_nombre: string | null;
  } | null;
};

export default async function ComparativasPage() {
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  /*
   * Se traen todas y se filtra en el navegador, a propósito. Son 1.078 filas
   * al 26/11/2026 y crecen de a dos dígitos por semana: a ese tamaño una
   * consulta por tecleo cuesta más de lo que ahorra, y buscar sin esperar es
   * justo lo que hace usable una pantalla de consulta. `traerTodo` está igual
   * porque PostgREST corta en 1000 sin avisar — y esta tabla ya pasó ese
   * número.
   */
  // El `as` es el mismo de `/compras/para-aprobar`: Supabase infiere los dos
  // embebidos como arreglos y la respuesta real trae un objeto en cada uno.
  const crudas = (await traerTodo((desde, hasta) =>
    supabase
      .from("compras_cotizaciones")
      .select(
        "id, precio_unitario, precio_total, cantidad, unidad_medida, marca, moneda, condiciones_pago, disponibilidad, proveedores(id, nombre), compras_requerimientos(id, nro_ri, descripcion, clave_articulo, fecha, comparativa_drive_id, comparativa_nombre)"
      )
      .range(desde, hasta)
  )) as unknown as FilaCruda[];

  const cotizaciones: CotizacionHistorica[] = crudas
    // Sin pedido o sin proveedor no hay nada que mostrar ni por dónde
    // buscarla. Hoy no hay ninguna así; el filtro existe para que una fila
    // rota no deje la pantalla en blanco.
    .filter((f) => f.compras_requerimientos && f.proveedores)
    .map((f) => {
      const ri = f.compras_requerimientos!;
      const prov = f.proveedores!;
      return {
        id: f.id,
        requerimientoId: ri.id,
        nroRi: ri.nro_ri,
        descripcion: ri.descripcion ?? "(sin descripción)",
        claveArticulo: ri.clave_articulo ?? ri.descripcion ?? "",
        fecha: ri.fecha,
        proveedorId: prov.id,
        proveedor: prov.nombre,
        marca: f.marca,
        moneda: f.moneda ?? "ARS",
        precioUnitario: f.precio_unitario,
        precioTotal: f.precio_total,
        cantidad: f.cantidad,
        unidadMedida: f.unidad_medida,
        condicionesPago: f.condiciones_pago,
        disponibilidad: f.disponibilidad,
        planillaId: ri.comparativa_drive_id,
        planillaNombre: ri.comparativa_nombre,
      };
    });

  // El desplegable lista sólo a los que cotizaron alguna vez: de los 484 del
  // padrón son 109, y ofrecer los otros 375 es ofrecer filtros que no
  // devuelven nada.
  const proveedores = [
    ...new Map(cotizaciones.map((c) => [c.proveedorId, c.proveedor])).entries(),
  ]
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  return <ComparativasClient cotizaciones={cotizaciones} proveedores={proveedores} />;
}
