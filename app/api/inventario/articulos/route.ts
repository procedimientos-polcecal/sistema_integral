import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hoyEnArgentina } from "@/lib/core/fechas";
import {
  pedidosAbiertosPorCodigo, type RequerimientoConCodigo,
} from "@/lib/inventario/reponer";

/**
 * Buscar un artículo por código o descripción.
 *
 * Alimenta el buscador del stock y el del formulario de movimiento. Consulta la
 * base y no la planilla: leer 2.800 filas de Sheets en cada tecla sería lento y
 * dependería de que Google conteste. El stock que devuelve es el de la última
 * sincronización, y la pantalla dice de cuándo es.
 *
 * Sin `q` devuelve los primeros por código, que es lo que se ve al abrir.
 *
 * Con `pedidos=1` cada fila **con faltante** trae además si ya tiene un RI
 * abierto, que es lo que el stock necesita para avisar antes de pedir de nuevo.
 * Va detrás de un parámetro y no siempre porque el otro llamador —el buscador
 * del formulario de movimiento— no lo usa, y sería una consulta por tecla
 * tirada a la basura.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  const soloFaltantes = params.get("faltantes") === "1";
  const conPedidos = params.get("pedidos") === "1";

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
  if (!conPedidos || !data?.length) return NextResponse.json({ data });

  // Sólo los que faltan: en los demás el botón no existe, así que preguntar por
  // su pedido sería traer algo que nadie mira. De las 50 filas que como mucho
  // devuelve la consulta de arriba, hoy unas pocas tienen faltante.
  const codigos = [...new Set(
    data.filter((a) => Number(a.faltante) > 0).map((a) => String(a.codigo).trim())
  )].filter(Boolean);

  if (codigos.length === 0) return NextResponse.json({ data });

  // `.in()` con como mucho 50 códigos: lejos del punto donde PostgREST rechaza
  // la URL con un 400 sin decir por qué. Sin `traerTodo()` por la misma razón:
  // son los RI de 50 códigos, no una tabla que crece sola.
  const { data: ris, error: errorRis } = await supabase
    .from("compras_requerimientos")
    .select("id, nro_ri, codigo, fecha, estado_aprobacion, estado_compra")
    .in("codigo", codigos);

  // Un fallo acá no voltea la búsqueda: el stock se sigue leyendo sin la marca
  // de "ya pedido". Lo que no se hace es tragárselo callado — la fila diría que
  // no hay pedido cuando lo que pasó es que no se pudo saber.
  if (errorRis) {
    return NextResponse.json({ data, errorPedidos: errorRis.message });
  }

  const abiertos = pedidosAbiertosPorCodigo(
    (ris ?? []) as RequerimientoConCodigo[],
    hoyEnArgentina()
  );

  return NextResponse.json({
    data: data.map((a) => {
      if (!(Number(a.faltante) > 0)) return a;
      const p = abiertos.get(String(a.codigo).trim());
      return {
        ...a,
        riAbierto: p
          ? {
              id: p.ri.id,
              nro_ri: p.ri.nro_ri,
              diasDelRi: p.diasDelRi,
              cuantosAbiertos: p.cuantosAbiertos,
            }
          : null,
      };
    }),
  });
}
