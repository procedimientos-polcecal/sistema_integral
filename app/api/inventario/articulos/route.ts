import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hoyEnArgentina } from "@/lib/core/fechas";
import {
  pedidosAbiertosPorCodigo, riAbiertoDe, riConEntrada,
  type RequerimientoConCodigo, type EntradaDeRequerimiento,
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
 * Con `pedidos=1` cada fila trae además si ya tiene un RI abierto, que es lo
 * que el stock y el catálogo necesitan para avisar antes de pedir de nuevo.
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

  // Todas las filas, no sólo las que faltan. Hasta el 14/10/2026 esto filtraba
  // por faltante, porque en los demás el botón no existía; desde que el
  // catálogo deja pedir cualquier artículo, esa premisa caducó. Siguen siendo
  // como mucho las 50 que devolvió la consulta de arriba.
  const codigos = [...new Set(
    data.map((a) => String(a.codigo).trim())
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

  // Qué llegó ya al pañol contra alguno de esos pedidos.
  //
  // **Se filtra por los ids de los RI y no por los 50 códigos**, que era lo
  // cómodo porque ya estaban acotados. Medido el 24/11/2026: de las 766
  // entradas que nombran un requerimiento, **16 llevan un código distinto al
  // del RI que dicen traer** —el RI 575 pide el `00109` y la entrada dice
  // `00110`—, así que filtrar por código se perdería esas y esta pantalla
  // seguiría diciendo «ya pedido» mientras `/inventario/reponer` dice que
  // llegó. Dos pantallas que contestan distinto a la misma pregunta es
  // exactamente lo que `pedidosAbiertosPorCodigo` existe para evitar.
  //
  // De a 150 porque un `.in()` largo lo rechaza PostgREST con un 400 sin decir
  // por qué. Con 50 códigos los RI son unas pocas decenas, así que hoy esto da
  // una sola vuelta; el lote está para que crecer no lo rompa en silencio.
  const idsDeLosRi = (ris ?? []).map((r) => r.id);
  const entradas: EntradaDeRequerimiento[] = [];
  for (let i = 0; i < idsDeLosRi.length; i += 150) {
    const { data: lote, error: errorEntradas } = await supabase
      .from("inventario_movimientos")
      .select("requerimiento_id, tipo")
      .in("requerimiento_id", idsDeLosRi.slice(i, i + 150));

    // Un fallo acá se trata como el de los RI: no voltea la búsqueda, pero no
    // se traga callado. La diferencia importa — sin esto, la fila diría «ya
    // pedido» de algo que llegó hace meses.
    if (errorEntradas) {
      return NextResponse.json({ data, errorPedidos: errorEntradas.message });
    }
    entradas.push(...((lote ?? []) as EntradaDeRequerimiento[]));
  }

  const abiertos = pedidosAbiertosPorCodigo(
    (ris ?? []) as RequerimientoConCodigo[],
    hoyEnArgentina(),
    riConEntrada(entradas)
  );

  return NextResponse.json({
    data: data.map((a) => {
      const p = abiertos.get(String(a.codigo).trim());
      return { ...a, riAbierto: p ? riAbiertoDe(p) : null };
    }),
  });
}
