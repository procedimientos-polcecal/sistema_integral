import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exportarRequerimiento } from "@/lib/compras/sheets";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { leerComparativa, agregarFila } from "@/lib/compras/drive";
import { cotizacionDeHoy } from "@/lib/compras/dolar";
import { mapearEncabezados, filaParaPlanilla } from "@/lib/compras/comparativa";

const CAMPOS = [
  "proveedor_id", "marca", "unidad_medida", "precio_unitario", "cantidad",
  "costo_envio", "descuento", "iva", "precio_hasta", "plazo_pago_dias",
  "condiciones_pago", "disponibilidad", "comentario", "url",
  // En qué moneda cotizó el proveedor. La conversión a pesos no se guarda:
  // se hace al mostrar, con el dólar del día, y recién se congela al elegir
  // este presupuesto.
  "moneda",
] as const;

/** Estados en los que la comparativa ya es el respaldo de una decisión tomada. */
const CONGELADOS = ["APROBADO", "PEDIDO", "RECIBIDO"];

/**
 * Carga un presupuesto en el sistema y lo escribe en la planilla adjunta.
 *
 * La app es donde se carga; la planilla se sigue llenando para que quede como
 * respaldo y como histórico de precios por artículo. Si Drive falla, el
 * presupuesto ya está guardado: se avisa y no se rompe la operación, el mismo
 * criterio que la sincronización con el master.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés permiso para gestionar la compra" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.proveedor_id) {
    return NextResponse.json({ error: "Hay que elegir el proveedor" }, { status: 400 });
  }
  if (body.precio_unitario === null || body.precio_unitario === undefined || body.precio_unitario === "") {
    return NextResponse.json({ error: "Hay que cargar el precio unitario" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: ri } = await admin
    .from("compras_requerimientos")
    // El select va en un solo literal: partido en dos, Supabase no lo puede
    // analizar y el tipo del resultado se cae a GenericStringError.
    .select("id, nro_ri, fecha, descripcion, estado_compra, estado_aprobacion, comparativa_drive_id, compras_areas(nombre)")
    .eq("id", id)
    .single();

  if (!ri) return NextResponse.json({ error: "El requerimiento no existe" }, { status: 404 });
  if (ri.estado_aprobacion !== "APROBADA") {
    return NextResponse.json(
      { error: "El requerimiento tiene que estar aprobado antes de cargar presupuestos" },
      { status: 409 }
    );
  }
  if (CONGELADOS.includes(ri.estado_compra)) {
    return NextResponse.json(
      { error: "La comparativa quedó congelada al aprobarse la compra" },
      { status: 409 }
    );
  }

  const registro: Record<string, unknown> = {
    requerimiento_id: id,
    origen: "app",
    created_by: user.id,
  };
  for (const campo of CAMPOS) {
    if (campo in body) registro[campo] = body[campo] === "" ? null : body[campo];
  }

  const { data: cotizacion, error } = await admin
    .from("compras_cotizaciones")
    .insert(registro)
    .select("*, proveedores(nombre)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Cargar el primer presupuesto pone el RI en comparativa: es el trabajo que
  // ese estado describe.
  let avisoSheets: string | null = null;
  if (ri.estado_compra === "SIN_INICIAR") {
    await admin
      .from("compras_requerimientos")
      .update({ estado_compra: "EN_COMPARATIVA" })
      .eq("id", id);

    // Y la planilla se entera. Faltaba, y dejaba a los dos lados diciendo
    // cosas distintas sin que nada lo avisara: la escritura no fallaba, no se
    // intentaba, así que no quedaba ni un pendiente que mirar.
    try {
      const { bloqueadas } = await exportarRequerimiento(id);
      if (bloqueadas.length > 0) {
        avisoSheets =
          "El presupuesto se guardó, pero la planilla no dejó actualizar el estado: " +
          bloqueadas.join(", ") + ". Hay que corregirlo a mano ahí.";
      }
    } catch (e) {
      avisoSheets = e instanceof Error ? e.message : String(e);
      console.error(`No se pudo escribir el RI ${id} en la planilla:`, avisoSheets);
    }
  }

  let avisoDrive: string | null = null;
  if (ri.comparativa_drive_id) {
    try {
      const planilla = await leerComparativa(ri.comparativa_drive_id);
      const mapeo = mapearEncabezados(planilla.encabezado);

      if (!mapeo.ok) {
        avisoDrive =
          "El presupuesto se guardó, pero la planilla no tiene la forma esperada " +
          `(faltan ${mapeo.faltan.join(", ")}): no se escribió ahí.`;
      } else {
        const area = ri.compras_areas as unknown as { nombre: string } | null;

        // La planilla es toda en pesos: si el presupuesto se cargó en dólares
        // hay que convertirlo, o la fórmula del total lo suma con los que están
        // en pesos y el más barato pasa a ser el que está en otra moneda.
        const dolar =
          cotizacion.moneda === "USD"
            ? cotizacion.cotizacion ?? (await cotizacionDeHoy())
            : null;

        // La fila la decide quien escribe, y la fórmula del total se arma con
        // ese mismo número: antes se calculaban por separado y no coincidían.
        const filaEscrita = await agregarFila(
          ri.comparativa_drive_id,
          planilla.pestana,
          (numeroFila) => filaParaPlanilla({
          idx: mapeo.idx,
          numeroFila,
          nroRi: ri.nro_ri,
          fecha: ri.fecha,
          area: area?.nombre ?? null,
          descripcion: ri.descripcion,
          moneda: cotizacion.moneda,
          dolar,
          cotizacion: {
            proveedor_nombre: cotizacion.proveedores?.nombre ?? "",
            marca: cotizacion.marca,
            unidad_medida: cotizacion.unidad_medida,
            precio_unitario: cotizacion.precio_unitario,
            cantidad: cotizacion.cantidad,
            costo_envio: cotizacion.costo_envio,
            descuento: cotizacion.descuento,
            iva: cotizacion.iva,
            precio_hasta: cotizacion.precio_hasta,
            plazo_pago_dias: cotizacion.plazo_pago_dias,
            condiciones_pago: cotizacion.condiciones_pago,
            disponibilidad: cotizacion.disponibilidad,
            comentario: cotizacion.comentario,
          },
          })
        );

        await admin
          .from("compras_cotizaciones")
          .update({ drive_fila: filaEscrita })
          .eq("id", cotizacion.id);
      }
    } catch (e) {
      avisoDrive =
        "El presupuesto se guardó, pero no se pudo escribir en la planilla: " +
        (e instanceof Error ? e.message : String(e));
    }
  }

  return NextResponse.json(
    {
      ...cotizacion,
      ...(avisoDrive ? { aviso_drive: avisoDrive } : {}),
      ...(avisoSheets ? { aviso_sheets: avisoSheets } : {}),
    },
    { status: 201 }
  );
}
