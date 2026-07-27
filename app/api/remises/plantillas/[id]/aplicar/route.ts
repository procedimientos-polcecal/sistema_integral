import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puede_editar_check } from "@/lib/remises/route-utils";
import { aplicarGrupos } from "@/lib/remises/generarRutas";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;

  const body = await request.json();
  const { fecha, turnoId } = body;
  if (!fecha || !turnoId) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });

  const { data: plantilla } = await supabase
    .from("remises_plantillas")
    .select("tipo, remises_plantillas_grupos(vehiculo_id, empleado_id)")
    .eq("id", id)
    .single();
  if (!plantilla) return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });

  const porVehiculo = new Map<string, string[]>();
  for (const g of plantilla.remises_plantillas_grupos as any[]) {
    const lista = porVehiculo.get(g.vehiculo_id) ?? [];
    lista.push(g.empleado_id);
    porVehiculo.set(g.vehiculo_id, lista);
  }
  const grupos = [...porVehiculo.entries()].map(([vehiculoId, empleadoIds]) => ({ vehiculoId, empleadoIds }));
  if (!grupos.length) return NextResponse.json({ error: "La plantilla no tiene empleados" }, { status: 400 });

  const resultado = await aplicarGrupos(supabase, { fecha, turnoId, tipo: plantilla.tipo, grupos });
  if ("error" in resultado) return NextResponse.json({ error: resultado.error }, { status: 400 });
  return NextResponse.json(resultado);
}
