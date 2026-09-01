import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check, puede_editar_check } from "@/lib/remises/route-utils";
import { agregarHojaRuta } from "@/lib/remises/generarRutas";
import { cuerpoJson } from "@/lib/core/cuerpo";

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const url = new URL(request.url);
  const fecha = url.searchParams.get("fecha");
  const turnoId = url.searchParams.get("turnoId");
  const tipo = url.searchParams.get("tipo");
  if (!fecha || !turnoId || !tipo) return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });

  const { data, error } = await supabase
    .from("hojas_ruta")
    .select(
      "*, vehiculos(id, nombre, capacidad), choferes(id, nombre, telefono), asientos(id, orden, empleado_id, empleados(id, legajo, nombre, apellido, remises_empleados_datos(direccion, lat, lng)))"
    )
    .eq("fecha", fecha)
    .eq("turno_id", turnoId)
    .eq("tipo", tipo)
    .order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const conAsientosOrdenados = (data ?? []).map((h: any) => ({
    ...h,
    asientos: (h.asientos ?? []).slice().sort((a: any, b: any) => a.orden - b.orden),
  }));
  return NextResponse.json(conAsientosOrdenados);
}

/** "+ Agregar remis": crea una hoja de ruta puntual para un vehículo con los empleados elegidos. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const { fecha, turnoId, tipo, vehiculoId, empleadoIds } = body;
  if (!fecha || !turnoId || (tipo !== "ida" && tipo !== "vuelta") || !vehiculoId || !empleadoIds?.length) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const resultado = await agregarHojaRuta(supabase, { fecha, turnoId, tipo, vehiculoId, empleadoIds });
  if ("error" in resultado) return NextResponse.json({ error: resultado.error }, { status: 400 });
  return NextResponse.json(resultado, { status: 201 });
}
