import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarTallerVial } from "@/lib/tallerVial/auth";
import { traerRepuestosAsignados } from "@/lib/tallerVial/consultas";

/**
 * Repuestos del pañol reservados para un service o una reparación de Taller
 * Vial. Reservar **no descuenta stock** — sólo dice "esto se va a usar" — y
 * es un insert liso y llano: la RLS de `taller_vial_repuestos_asignados`
 * (migración 20260917105422) ya exige `puede_editar_taller_vial()` y que
 * nazca en estado 'reservado', así que no hace falta una función aparte para
 * esto. Confirmar la baja real es cosa de Inventario
 * (`/api/inventario/reservas-taller-vial`), no de acá.
 */

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const url = new URL(request.url);
  const serviceId = url.searchParams.get("service_id") ?? undefined;
  const reparacionId = url.searchParams.get("reparacion_id") ?? undefined;
  if (!serviceId && !reparacionId) {
    return NextResponse.json({ error: "Falta service_id o reparacion_id" }, { status: 400 });
  }

  const data = await traerRepuestosAsignados(supabase, { serviceId, reparacionId });
  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarTallerVial(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para reservar un repuesto" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  const serviceId = b?.service_id ? String(b.service_id) : null;
  const reparacionId = b?.reparacion_id ? String(b.reparacion_id) : null;
  if ((serviceId === null) === (reparacionId === null)) {
    return NextResponse.json({ error: "Tiene que venir exactamente un service o una reparación" }, { status: 400 });
  }
  const articuloId = String(b?.articulo_id ?? "");
  if (!articuloId) return NextResponse.json({ error: "Falta el artículo" }, { status: 400 });
  const cantidad = Number(b?.cantidad);
  if (!isFinite(cantidad) || cantidad <= 0) {
    return NextResponse.json({ error: "La cantidad tiene que ser mayor a cero" }, { status: 400 });
  }

  // Aviso informativo, no un bloqueo a nivel base: la RLS deja reservar
  // igual (la reserva no descuenta nada), pero acá se avisa si ya no
  // quedaría stock para cuando Inventario tenga que confirmarla, con el
  // artículo a mano para poder ofrecer "hacer un requerimiento".
  const { data: articulo } = await supabase
    .from("inventario_articulos")
    .select("id, codigo, descripcion, stock_actual")
    .eq("id", articuloId)
    .maybeSingle();
  if (!articulo) return NextResponse.json({ error: "Ese artículo no existe" }, { status: 400 });

  const { data, error } = await supabase
    .from("taller_vial_repuestos_asignados")
    .insert({
      service_id: serviceId,
      reparacion_id: reparacionId,
      articulo_id: articuloId,
      cantidad,
      cargado_por: user.id,
    })
    .select("id, service_id, reparacion_id, articulo_id, cantidad, estado, cargado_por, cargado_en")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const sinStockSuficiente = articulo.stock_actual < cantidad;
  return NextResponse.json({
    data,
    aviso: sinStockSuficiente
      ? {
          tipo: "STOCK_INSUFICIENTE",
          mensaje: `En el pañol quedan ${articulo.stock_actual} de "${articulo.descripcion}" — se reservaron ${cantidad}.`,
          articulo: { codigo: articulo.codigo, descripcion: articulo.descripcion, stock: articulo.stock_actual },
        }
      : null,
  });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el id" }, { status: 400 });

  // La RLS decide quién puede cancelar (Taller Vial o Inventario, y sólo
  // mientras siga 'reservado'): si no corresponde, el delete no afecta
  // ninguna fila y PostgREST no lo distingue de "no existía".
  const { error, count } = await supabase
    .from("taller_vial_repuestos_asignados")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (count === 0) {
    return NextResponse.json({ error: "No se pudo cancelar — ya se confirmó, o no tenés permiso" }, { status: 403 });
  }
  return NextResponse.json({ data: null });
}
