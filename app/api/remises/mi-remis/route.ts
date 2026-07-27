import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}
function manana(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase.from("usuarios").select("empleado_id").eq("id", user.id).single();
  if (!usuario?.empleado_id) return NextResponse.json({ error: "Esta cuenta no tiene un empleado vinculado" }, { status: 403 });

  const url = new URL(request.url);
  const dia = url.searchParams.get("dia") === "manana" ? manana() : hoy();

  // RLS de asientos/hojas_ruta/vehiculos/choferes deja pasar esto por
  // es_mi_asiento(), sin necesitar tiene_acceso_remises().
  const { data: misAsientos } = await supabase
    .from("asientos")
    .select("hoja_ruta_id, hojas_ruta(fecha, tipo, hora_salida, vehiculos(nombre), choferes(nombre, telefono))")
    .eq("empleado_id", usuario.empleado_id);

  const hojaIds = (misAsientos ?? [])
    .filter((a: any) => a.hojas_ruta?.fecha === dia)
    .map((a) => a.hoja_ruta_id);

  if (!hojaIds.length) return NextResponse.json({ dia, asignaciones: [] });

  const { data: hojas } = await supabase
    .from("hojas_ruta")
    .select("id, tipo, hora_salida, vehiculos(nombre), choferes(nombre, telefono), asientos(empleado_id, empleados(nombre, apellido))")
    .in("id", hojaIds);

  const asignaciones = (hojas ?? []).map((h: any) => ({
    tipo: h.tipo,
    horaSalida: h.hora_salida,
    vehiculo: h.vehiculos?.nombre ?? null,
    chofer: h.choferes?.nombre ?? null,
    choferTelefono: h.choferes?.telefono ?? null,
    companeros: (h.asientos ?? [])
      .filter((a: any) => a.empleado_id !== usuario.empleado_id)
      .map((a: any) => `${a.empleados?.apellido}, ${a.empleados?.nombre}`),
  }));

  return NextResponse.json({ dia, asignaciones });
}
