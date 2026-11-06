import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * De qué área es quien está pidiendo.
 *
 * Lo usa `NuevoRequerimientoModal` para traer el campo Área ya completo. Lo
 * pide **el modal y no las pantallas**: son seis las que lo montan —Compras,
 * los tres listados de Inventario, los repuestos de una OT y Mis pedidos— y
 * pasárselo a las seis es seis lugares donde olvidarse de uno.
 *
 * Es de lectura y de la fila propia, así que va con el cliente de la sesión:
 * la policy de `usuario_areas_compras` ya deja ver lo de uno.
 *
 * Devuelve la lista y no "el área" porque alguien puede tener más de una, y
 * quién elige en ese caso lo decide `areaPorDefecto` — que es pura y tiene sus
 * tests. Acá no se decide nada.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data, error } = await supabase
    .from("usuario_areas_compras")
    .select("area_id")
    .eq("usuario_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: (data ?? []).map((a) => a.area_id as string) });
}
