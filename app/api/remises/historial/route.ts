import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tiene_acceso_check } from "@/lib/remises/route-utils";

/** Historial = hojas de ruta ya generadas, agrupadas por fecha/turno/tipo (últimas 60). */
export async function GET() {
  const supabase = await createClient();
  const check = await tiene_acceso_check(supabase);
  if (check) return check;

  const { data, error } = await supabase
    .from("hojas_ruta")
    .select(
      "id, fecha, tipo, turno_id, remises_turnos(nombre), vehiculos(id, nombre), asientos(empleado_id, empleados(nombre, apellido))"
    )
    .order("fecha", { ascending: false })
    .limit(300);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const grupos = new Map<string, any>();
  for (const h of (data ?? []) as any[]) {
    const clave = `${h.fecha}__${h.turno_id}__${h.tipo}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, { fecha: h.fecha, turnoId: h.turno_id, turnoNombre: h.remises_turnos?.nombre, tipo: h.tipo, hojas: [] });
    }
    grupos.get(clave).hojas.push(h);
  }

  return NextResponse.json([...grupos.values()].slice(0, 60));
}
