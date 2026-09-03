import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarInventario } from "@/lib/inventario/auth";
import { espejarMovimiento } from "@/lib/inventario/espejo";
import { loQueFalta, type TipoMovimiento } from "@/lib/inventario/movimiento";

/**
 * Registrar una entrada, una salida o un ajuste.
 *
 * Dos pasos y los dos importan:
 *
 * 1. El **RPC**, que baja o sube el stock con bloqueo de fila. Es lo que evita
 *    que dos salidas simultáneas del mismo artículo dejen el stock mal.
 * 2. El **espejo a la planilla**, que no es opcional aunque lo parezca. La
 *    planilla manda: un movimiento que no llega allá se revierte solo en la
 *    próxima sincronización, porque el stock sale de sus fórmulas.
 *
 * Por eso el espejo **no corre en segundo plano**. El repo de origen lo mandaba
 * a `after()` para responder al instante, y el precio era que su fallo terminaba
 * en un `console.warn` que nadie mira. Acá se espera el resultado, se anota el
 * pendiente si falló, y se le dice a quien cargó. Es un segundo más de espera a
 * cambio de saber si lo que cargaste existe.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarInventario(supabase, user.id))) {
    return NextResponse.json(
      { error: "Registrar movimientos requiere nivel de edición en Inventario" },
      { status: 403 }
    );
  }

  const b = await request.json().catch(() => null);
  const articulo_id = String(b?.articulo_id ?? "").trim();
  const tipo = String(b?.tipo ?? "").trim();
  const cantidad = Number(b?.cantidad);

  if (!["entrada", "salida", "ajuste"].includes(tipo)) {
    return NextResponse.json({ error: "Tipo de movimiento inválido" }, { status: 400 });
  }

  // La misma regla que el formulario, aplicada de nuevo acá: nada obliga a
  // pasar por el formulario, y una fila incompleta en la planilla la lee gente
  // que no entra al sistema y no la puede arreglar.
  const faltan = loQueFalta({
    articuloId: articulo_id,
    tipo: tipo as TipoMovimiento,
    cantidad: b?.cantidad,
    empleadoId: b?.empleado_id,
  });
  if (faltan.length > 0) {
    return NextResponse.json({ error: faltan.join(" ") }, { status: 400 });
  }

  const texto = (v: unknown) => String(v ?? "").trim() || null;
  const admin = createAdminClient();

  // El RPC valida el permiso él mismo y hace el bloqueo de fila.
  const { data: mov, error } = await admin.rpc("inventario_registrar_movimiento", {
    p_articulo_id: articulo_id,
    p_tipo: tipo,
    p_cantidad: cantidad,
    p_creado_por: user.id,
    p_solicitante: texto(b?.solicitante),
    p_sector_id: texto(b?.sector_id),
    p_equipment_id: texto(b?.equipment_id),
    p_proveedor_id: texto(b?.proveedor_id),
    p_empleado_id: texto(b?.empleado_id),
    p_ri: Number.isInteger(Number(b?.ri)) && Number(b?.ri) > 0 ? Number(b?.ri) : null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Lo que la planilla necesita en texto: nombres, no ids.
  const { data: articulo } = await admin
    .from("inventario_articulos")
    .select("descripcion")
    .eq("id", articulo_id)
    .single();

  // Los nombres tal como van a quedar escritos en la planilla. Se guardan
  // también en las columnas `_raw`, que es de donde el kardex de la app lee el
  // sector y el proveedor: sin esto, un movimiento cargado acá se muestra sin
  // sector hasta que la sincronización vuelva a leer su propia fila.
  const sector_raw = texto(b?.sector_nombre);
  const proveedor_raw = texto(b?.proveedor_nombre);

  const espejo = await espejarMovimiento({
    ri: mov.ri,
    codigo: mov.codigo,
    descripcion: articulo?.descripcion ?? null,
    tipo: tipo as TipoMovimiento,
    cantidad,
    stock_anterior: mov.stock_anterior,
    stock_resultante: mov.stock_resultante,
    solicitante: mov.solicitante,
    proveedor: proveedor_raw,
    sector: sector_raw,
    fecha: mov.fecha,
  });

  // El pendiente se anota o se limpia; nunca queda a medias.
  await admin
    .from("inventario_movimientos")
    .update({
      sector_raw,
      proveedor_raw,
      ...(espejo.ok
        ? { sheets_fila: espejo.fila, sheets_pendiente: null, sheets_pendiente_en: null }
        : { sheets_pendiente: espejo.error ?? "no se pudo escribir", sheets_pendiente_en: new Date().toISOString() }),
    })
    .eq("id", mov.id);

  return NextResponse.json({
    data: { ...mov, sheets_fila: espejo.ok ? espejo.fila : null },
    stock_resultante: mov.stock_resultante,
    // Que la pantalla pueda decirlo. Sin esto, quien cargó se va convencido de
    // que quedó, y el stock vuelve atrás en la próxima sincronización.
    planilla_error: espejo.ok ? null : espejo.error,
  });
}
