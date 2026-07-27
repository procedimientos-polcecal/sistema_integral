import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/remises/route-utils";
import { aplicarGrupos } from "@/lib/remises/generarRutas";

/** "Reutilizar" una entrada de historial en una fecha nueva. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await request.json();
  const { hojaIds, fecha, turnoId, tipo } = body;
  if (!hojaIds?.length || !fecha || !turnoId || (tipo !== "ida" && tipo !== "vuelta")) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const { data: hojas } = await supabase.from("hojas_ruta").select("vehiculo_id, asientos(empleado_id)").in("id", hojaIds);
  const grupos = (hojas ?? []).map((h: any) => ({
    vehiculoId: h.vehiculo_id,
    empleadoIds: (h.asientos ?? []).map((a: any) => a.empleado_id),
  }));
  if (!grupos.length) return NextResponse.json({ error: "No se encontraron las hojas de ruta origen" }, { status: 400 });

  const resultado = await aplicarGrupos(supabase, { fecha, turnoId, tipo, grupos });
  if ("error" in resultado) return NextResponse.json({ error: resultado.error }, { status: 400 });
  return NextResponse.json(resultado);
}
