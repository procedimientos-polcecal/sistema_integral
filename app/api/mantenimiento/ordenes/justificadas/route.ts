import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { puedeVerMantenimiento } from "@/lib/mantenimiento/auth";

/**
 * Cuáles de estas órdenes ya tienen una justificación.
 *
 * Es lo que le falta al listado para poder marcar las abiertas que **nadie
 * explicó**, que son las que hay que ir a buscar. Las que sí tienen una no
 * llevan cartel: para leerla se abre la orden.
 *
 * Va aparte y no como un embed del listado a propósito. Un
 * `ordenes_trabajo_notas(count)` colgado del `select` de las órdenes funciona
 * —está probado— pero ata el listado entero a que la tabla exista: un deploy
 * antes de correr la migración dejaría la pantalla de órdenes en 400. Acá, lo
 * único que pasa es que los carteles no aparecen.
 *
 * Se pasan los ids que se están viendo —cincuenta como mucho, los de la página—
 * y no se devuelve la tabla entera: un `.in()` acotado por construcción no
 * necesita paginarse ni crece con los años.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeVerMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const crudo = new URL(request.url).searchParams.get("ordenes") ?? "";
  const ordenes = [...new Set(crudo.split(",").map((x) => x.trim()).filter(Boolean))];

  // Sin ids no hay nada que contestar, y un `.in()` vacío trae toda la tabla.
  if (ordenes.length === 0) return NextResponse.json({ data: [] });

  // De a lotes: un `.in()` con muchos ids arma una URL que PostgREST rechaza
  // con un 400 sin decir por qué. Hoy llegan cincuenta, pero el tope no se
  // apoya en eso.
  const conJustificacion = new Set<string>();

  for (let i = 0; i < ordenes.length; i += 200) {
    const { data, error } = await supabase
      .from("ordenes_trabajo_notas")
      .select("orden_id")
      .in("orden_id", ordenes.slice(i, i + 200));

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    for (const fila of data ?? []) conJustificacion.add(fila.orden_id as string);
  }

  return NextResponse.json({ data: [...conJustificacion] });
}
