import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tieneAccesoTallerVial } from "@/lib/tallerVial/auth";

/**
 * Buscar en el pañol, para el autocompletado de "reservar un repuesto".
 *
 * A diferencia de `/api/mantenimiento/inventario` (que resuelve texto libre
 * contra un catálogo sin id, sólo para mostrar disponibilidad), acá hace
 * falta el `id` real del artículo: la reserva queda con una FK de verdad a
 * `inventario_articulos`, no con un matching de texto en cada lectura.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoTallerVial(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Taller Vial" }, { status: 403 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 3) return NextResponse.json({ data: [] });

  // `%,()` fuera: son caracteres con significado propio en el filtro `.or()`
  // de PostgREST, mismo saneo que ya usa `/api/mantenimiento/inventario`.
  const qLimpio = q.replace(/[%,()]/g, " ");

  const { data, error } = await supabase
    .from("inventario_articulos")
    .select("id, codigo, descripcion, stock_actual, stock_seguridad, ubicacion")
    .eq("activo", true)
    .or(`codigo.ilike.%${qLimpio}%,descripcion.ilike.%${qLimpio}%`)
    .order("descripcion")
    .limit(20);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
