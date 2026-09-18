import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tieneAccesoTallerVial } from "@/lib/tallerVial/auth";
import { terminoDePanolDelEquipo } from "@/lib/tallerVial/equipos";

/**
 * Buscar en el pañol, para el autocompletado de "reservar un repuesto".
 *
 * A diferencia de `/api/mantenimiento/inventario` (que resuelve texto libre
 * contra un catálogo sin id, sólo para mostrar disponibilidad), acá hace
 * falta el `id` real del artículo: la reserva queda con una FK de verdad a
 * `inventario_articulos`, no con un matching de texto en cada lectura.
 *
 * Con `equipo_id`, la búsqueda se acota primero al modelo de ese equipo
 * (`terminoDePanolDelEquipo`, `lib/tallerVial/equipos.ts`) y recién adentro
 * de eso se aplica lo que se haya escrito — así "aceite" en el buscador de
 * un Doosan 225 no trae los filtros de un Caterpillar. Si el equipo no
 * tiene un término mapeado, se busca en todo el pañol como si no se
 * hubiera pasado `equipo_id`: no tener el dato no es lo mismo que "no tiene
 * repuestos".
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
  const equipoId = url.searchParams.get("equipo_id");

  let termino: string | null = null;
  if (equipoId) {
    const { data: equipo } = await supabase.from("equipos").select("code").eq("id", equipoId).maybeSingle();
    termino = equipo ? terminoDePanolDelEquipo(equipo.code) : null;
  }

  // Sin equipo acotado, hace falta escribir algo: buscar en las 1.157 filas
  // del pañol sin ningún filtro sería devolver cualquier cosa. Acotado a un
  // modelo, la lista ya es chica (una docena de artículos) y tiene sentido
  // mostrarla completa apenas se elige el equipo, sin esperar a que se
  // escriba nada.
  if (!termino && q.length < 3) return NextResponse.json({ data: [] });

  // `%,()` fuera: son caracteres con significado propio en el filtro `.or()`
  // de PostgREST, mismo saneo que ya usa `/api/mantenimiento/inventario`.
  const qLimpio = q.replace(/[%,()]/g, " ");

  let consulta = supabase
    .from("inventario_articulos")
    .select("id, codigo, descripcion, stock_actual, stock_seguridad, ubicacion")
    .eq("activo", true);

  if (termino) consulta = consulta.ilike("descripcion", `%${termino}%`);
  if (qLimpio) consulta = consulta.or(`codigo.ilike.%${qLimpio}%,descripcion.ilike.%${qLimpio}%`);

  const { data, error } = await consulta.order("descripcion").limit(30);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
