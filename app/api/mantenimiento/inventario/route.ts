import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { traerTodo } from "@/lib/core/paginado";
import { buscarEnInventario, type Insumo } from "@/lib/mantenimiento/stock";

/**
 * Qué hay en el pañol.
 *
 * **Ahora sale de `inventario_articulos` y no de la planilla.** Antes se leía el
 * Sheets en vivo, y la razón era buena —el stock cambia cada vez que alguien
 * retira algo—, pero traía tres problemas: era lento, dependía de que Google
 * contestara, y cuando la planilla no estaba configurada el autocompletado
 * devolvía una lista vacía sin explicar nada. Escribías y no pasaba nada.
 *
 * A cambio, el número es el de la última sincronización y no el de este
 * segundo. Por eso viaja `sincronizado_en`: la pantalla dice de cuándo es, en
 * vez de mostrarlo como si fuera de ahora. Y por eso la sincronización tiene
 * reloj.
 *
 * El inventario no lo maneja Mantenimiento: si todavía no se importó nada, la
 * respuesta lo dice y la pantalla sigue andando sin disponibilidad. Anotar qué
 * repuestos hacen falta no depende de saber si los hay.
 */

interface FilaArticulo {
  codigo: string;
  descripcion: string;
  ubicacion: string | null;
  stock_actual: number;
  stock_planilla: number | null;
  stock_seguridad: number;
  stock_sincronizado_en: string | null;
}

const CAMPOS =
  "codigo, descripcion, ubicacion, stock_actual, stock_planilla, stock_seguridad, stock_sincronizado_en";

/**
 * Una fila de la tabla como la espera `buscarEnInventario`.
 *
 * El stock es `null` cuando la celda de la planilla estaba vacía —nadie lo
 * contó—, y el número operativo cuando sí la contaron. Es lo que mantiene viva
 * la distinción entre "no hay" y "no se sabe", que la pantalla de repuestos
 * hace y que sin `stock_planilla` se habría perdido al dejar de leer el Sheets.
 */
function comoInsumo(f: FilaArticulo): Insumo {
  return {
    codigo: f.codigo,
    descripcion: f.descripcion,
    stock: f.stock_planilla === null ? null : f.stock_actual,
    seguridad: f.stock_seguridad,
    ubicacion: f.ubicacion,
  };
}

/** GET ?q= — buscar en el inventario, para el autocompletado. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();

  const consulta = supabase
    .from("inventario_articulos")
    .select(CAMPOS)
    .eq("activo", true);

  const { data, error } = q
    ? await consulta
        .or(`codigo.ilike.${q.replace(/[%,()]/g, " ")}%,descripcion.ilike.%${q.replace(/[%,()]/g, " ")}%`)
        .order("codigo")
        .limit(30)
    : await consulta.order("codigo").limit(30);

  if (error) {
    return NextResponse.json({
      cargado: true, data: [],
      error: `No se pudo leer el inventario: ${error.message}`,
    });
  }

  const filas = (data ?? []) as FilaArticulo[];
  return NextResponse.json({
    // `cargado: false` es "el inventario todavía no se importó", que la pantalla
    // muestra igual que antes mostraba "no está conectado".
    cargado: filas.length > 0 || q.length > 0,
    data: filas.map(comoInsumo),
    sincronizado_en: filas[0]?.stock_sincronizado_en ?? null,
  });
}

/** POST — qué hay de cada repuesto de una lista. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const b = await request.json().catch(() => null);
  const repuestos = Array.isArray(b?.repuestos) ? b.repuestos : [];

  // El catálogo entero: `buscarEnInventario` busca por código, por nombre exacto
  // y por coincidencia parcial, así que necesita verlo completo. Son 2.800 filas
  // de la base, no de Sheets.
  const filas = await traerTodo<FilaArticulo>((desde, hasta) =>
    supabase.from("inventario_articulos").select(CAMPOS).eq("activo", true).range(desde, hasta)
  );

  if (filas.length === 0) {
    return NextResponse.json({ configurado: false, cargado: false, disponibilidad: [] });
  }

  return NextResponse.json({
    // `configurado` se mantiene por compatibilidad con la pantalla, que lo usa
    // para decidir si muestra el cartel.
    configurado: true,
    cargado: true,
    sincronizado_en: filas[0]?.stock_sincronizado_en ?? null,
    disponibilidad: buscarEnInventario(repuestos, filas.map(comoInsumo)),
  });
}
