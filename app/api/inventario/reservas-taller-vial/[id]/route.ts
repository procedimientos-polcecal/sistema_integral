import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeEditarInventario } from "@/lib/inventario/auth";

/**
 * Confirmar una reserva de Taller Vial: acá es donde el stock baja de
 * verdad. Usa `inventario_registrar_movimiento()` (046) tal cual, con la
 * sesión de quien confirma —no con el cliente admin—, porque la función
 * comprueba `puede_editar_inventario()` con `auth.uid()` y con el admin esa
 * comprobación siempre da falso (ver el comentario largo en
 * `/api/inventario/movimientos`). El RPC hace el lock de fila y el kardex;
 * acá sólo queda marcar la reserva como confirmada con el `movimiento_id`
 * que devolvió.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarInventario(supabase, user.id))) {
    return NextResponse.json({ error: "Confirmar una baja requiere nivel de edición en Inventario" }, { status: 403 });
  }

  const { data: reserva, error: errReserva } = await supabase
    .from("taller_vial_repuestos_asignados")
    .select("id, articulo_id, cantidad, service_id, reparacion_id, estado")
    .eq("id", id)
    .maybeSingle();
  if (errReserva) return NextResponse.json({ error: errReserva.message }, { status: 400 });
  if (!reserva) return NextResponse.json({ error: "La reserva no existe" }, { status: 404 });
  if (reserva.estado !== "reservado") {
    return NextResponse.json({ error: "Esta reserva ya se confirmó o se canceló" }, { status: 400 });
  }

  let equipoId: string | null = null;
  if (reserva.service_id) {
    const { data } = await supabase.from("taller_vial_services").select("equipo_id").eq("id", reserva.service_id).maybeSingle();
    equipoId = data?.equipo_id ?? null;
  } else if (reserva.reparacion_id) {
    const { data } = await supabase.from("taller_vial_reparaciones").select("equipo_id").eq("id", reserva.reparacion_id).maybeSingle();
    equipoId = data?.equipo_id ?? null;
  }

  const { data: mov, error: errMov } = await supabase.rpc("inventario_registrar_movimiento", {
    p_articulo_id: reserva.articulo_id,
    p_tipo: "salida",
    p_cantidad: reserva.cantidad,
    p_creado_por: user.id,
    p_equipment_id: equipoId,
  });
  if (errMov) return NextResponse.json({ error: errMov.message }, { status: 400 });

  const { data, error } = await supabase
    .from("taller_vial_repuestos_asignados")
    .update({ estado: "confirmado", movimiento_id: mov.id, confirmado_por: user.id, confirmado_en: new Date().toISOString() })
    .eq("id", id)
    .select("id, estado, movimiento_id, confirmado_por, confirmado_en")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ data });
}

/** Cancelar: no hay nada que devolver porque reservar nunca descontó — se borra y listo. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

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
