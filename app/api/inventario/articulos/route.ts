import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Buscar un artículo por código o descripción.
 *
 * Alimenta el buscador del stock y el del formulario de movimiento. Consulta la
 * base y no la planilla: leer 2.800 filas de Sheets en cada tecla sería lento y
 * dependería de que Google conteste. El stock que devuelve es el de la última
 * sincronización, y la pantalla dice de cuándo es.
 *
 * Sin `q` devuelve los primeros por código, que es lo que se ve al abrir.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  const soloFaltantes = params.get("faltantes") === "1";

  // RLS filtra por acceso al módulo: si no lo tiene, la lista viene vacía.
  let consulta = supabase
    .from("inventario_articulos")
    .select("id, codigo, descripcion, ubicacion, stock_actual, stock_seguridad, faltante, stock_sincronizado_en")
    .eq("activo", true);

  if (q) {
    // El código se busca por prefijo y la descripción por contenido: nadie
    // escribe el final de un código, pero sí una palabra del medio del nombre.
    const escapado = q.replace(/[%,()]/g, " ");
    consulta = consulta.or(`codigo.ilike.${escapado}%,descripcion.ilike.%${escapado}%`);
  }
  if (soloFaltantes) consulta = consulta.gt("faltante", 0);

  const { data, error } = await consulta.order("codigo").limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}
