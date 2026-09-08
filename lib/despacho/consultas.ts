import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import type { OrdenDeCarga, ProductoDeDespacho } from "./types";

/**
 * Las lecturas de Despacho.
 *
 * Dos reglas del repo que acá pesan:
 *
 * **`traerTodo()` y no `.limit()`.** PostgREST corta en 1000 filas y no avisa.
 * Son ~25 órdenes por día, o sea que esta tabla pasa las 1000 en mes y medio, y
 * el histórico importado ya arranca arriba. No hay que razonar "esta tabla es
 * chica": el tablero de Compras parecía una cola acotada y arrastra 1.900 filas.
 *
 * **El `select()` va literal en cada llamada.** Armado en una constante,
 * Supabase pierde la inferencia de tipos y todo lo de abajo queda en `any`. Sí,
 * se repite; la alternativa es peor.
 */

export async function traerMapeoDeProductos(
  supabase: SupabaseClient
): Promise<ProductoDeDespacho[]> {
  const filas = await traerTodo<ProductoDeDespacho>((desde, hasta) =>
    supabase
      .from("despacho_productos")
      .select(
        "id, odoo_product_id, odoo_default_code, odoo_nombre, material, granulometria, envase, produccion_producto_id, activo"
      )
      .order("odoo_nombre")
      .range(desde, hasta)
  );
  return filas;
}

/** Las órdenes de un día de calendario, cerradas o no. */
export async function traerOrdenesDelDia(
  supabase: SupabaseClient,
  fecha: string
): Promise<OrdenDeCarga[]> {
  return traerTodo<OrdenDeCarga>((desde, hasta) =>
    supabase
      .from("despacho_ordenes_carga")
      .select(
        "id, numero, fecha, empresa_id, odoo_picking_id, odoo_picking_name, odoo_sale_name, odoo_product_id, cliente_raw, producto_raw, cantidad, unidad, entrada_predio, inicio_carga, fin_carga, salida_predio, notas, supervisor_raw, supervisor_id, sheets_fila, sheets_pendiente, sheets_pendiente_en"
      )
      .eq("fecha", fecha)
      .order("numero")
      .range(desde, hasta)
  );
}

/**
 * Las órdenes que quedaron abiertas de días anteriores.
 *
 * Van arriba en la cola del día y no escondidas en el histórico: una orden sin
 * cerrar es un camión que se fue sin que nadie marcara la salida, y si sólo
 * apareciera en el día que le toca nadie la va a corregir nunca. Además no
 * llegó a la planilla —el espejo escribe al cerrar—, así que arrastrarla es
 * arrastrar una divergencia.
 */
export async function traerOrdenesAbiertasAnteriores(
  supabase: SupabaseClient,
  fecha: string
): Promise<OrdenDeCarga[]> {
  return traerTodo<OrdenDeCarga>((desde, hasta) =>
    supabase
      .from("despacho_ordenes_carga")
      .select(
        "id, numero, fecha, empresa_id, odoo_picking_id, odoo_picking_name, odoo_sale_name, odoo_product_id, cliente_raw, producto_raw, cantidad, unidad, entrada_predio, inicio_carga, fin_carga, salida_predio, notas, supervisor_raw, supervisor_id, sheets_fila, sheets_pendiente, sheets_pendiente_en"
      )
      .lt("fecha", fecha)
      .is("salida_predio", null)
      .order("fecha", { ascending: false })
      .range(desde, hasta)
  );
}

/**
 * Qué productos aparecieron en órdenes, y en cuántas.
 *
 * Ordena la pantalla de mapeo por lo que más se usa: mapear los primeros cinco
 * cubre casi todo el volumen, y así lo que falta se ve arriba en vez de perdido
 * entre los 432 productos que tiene Odoo.
 *
 * Se cuenta en memoria y no con un `group by` de PostgREST a propósito: son dos
 * columnas de una tabla que ya se pagina con `traerTodo`, y el agrupado de
 * PostgREST obliga a una vista o a una función en la base para algo que acá son
 * cuatro líneas.
 */
export async function productosUsadosEnOrdenes(
  supabase: SupabaseClient
): Promise<{ odoo_product_id: number | null; producto_raw: string | null; ordenes: number }[]> {
  const filas = await traerTodo<{ odoo_product_id: number | null; producto_raw: string | null }>(
    (desde, hasta) =>
      supabase
        .from("despacho_ordenes_carga")
        .select("odoo_product_id, producto_raw")
        .range(desde, hasta)
  );

  const cuenta = new Map<string, { odoo_product_id: number | null; producto_raw: string | null; ordenes: number }>();
  for (const f of filas) {
    // Las órdenes sin remito no tienen producto de Odoo: se agrupan por el texto
    // que escribió el encargado, que es lo único que las identifica.
    const clave = f.odoo_product_id !== null ? `id:${f.odoo_product_id}` : `raw:${f.producto_raw ?? ""}`;
    const previo = cuenta.get(clave);
    if (previo) previo.ordenes++;
    else cuenta.set(clave, { odoo_product_id: f.odoo_product_id, producto_raw: f.producto_raw, ordenes: 1 });
  }

  return [...cuenta.values()].sort((a, b) => b.ordenes - a.ordenes);
}

/**
 * De qué empresa del SdG es un remito, según la empresa de Odoo que lo emitió.
 *
 * El mapeo vive en `empresas.odoo_company_id` (migración 045 y
 * 20260903082202), no como constante acá: el nombre de la base de Odoo lleva el
 * id del build, así que si alguna vez se restaura desde otra instancia los ids
 * cambian y hay que corregir un dato, no el código.
 */
export async function empresasPorOdoo(supabase: SupabaseClient): Promise<Map<number, string>> {
  const { data } = await supabase
    .from("empresas")
    .select("id, odoo_company_id")
    .not("odoo_company_id", "is", null);

  const mapa = new Map<number, string>();
  for (const e of data ?? []) {
    if (typeof e.odoo_company_id === "number") mapa.set(e.odoo_company_id, e.id as string);
  }
  return mapa;
}

export interface FiltrosDeOrdenes {
  desde?: string;
  hasta?: string;
  cliente?: string;
  empresaId?: string;
}

/**
 * El histórico, filtrado.
 *
 * Material y envase **no se filtran acá**: viven en el mapeo de productos, no en
 * la orden, así que se resuelven en memoria contra `despacho_productos`. Hacerlo
 * en la consulta requeriría un join sobre `odoo_product_id`, que es un int y no
 * una FK — y no lo es a propósito: una orden puede tener un producto que nadie
 * mapeó todavía, y una FK la rechazaría en vez de dejarla entrar sin clasificar.
 */
export async function traerOrdenes(
  supabase: SupabaseClient,
  filtros: FiltrosDeOrdenes
): Promise<OrdenDeCarga[]> {
  return traerTodo<OrdenDeCarga>((desde, hasta) => {
    let q = supabase
      .from("despacho_ordenes_carga")
      .select(
        "id, numero, fecha, empresa_id, odoo_picking_id, odoo_picking_name, odoo_sale_name, odoo_product_id, cliente_raw, producto_raw, cantidad, unidad, entrada_predio, inicio_carga, fin_carga, salida_predio, notas, supervisor_raw, supervisor_id, sheets_fila, sheets_pendiente, sheets_pendiente_en"
      );

    if (filtros.desde) q = q.gte("fecha", filtros.desde);
    if (filtros.hasta) q = q.lte("fecha", filtros.hasta);
    if (filtros.empresaId) q = q.eq("empresa_id", filtros.empresaId);
    if (filtros.cliente) q = q.ilike("cliente_raw", `%${filtros.cliente}%`);

    return q.order("fecha", { ascending: false }).order("numero").range(desde, hasta);
  });
}

export async function traerOrden(
  supabase: SupabaseClient,
  id: string
): Promise<OrdenDeCarga | null> {
  const { data } = await supabase
    .from("despacho_ordenes_carga")
    .select(
      "id, numero, fecha, empresa_id, odoo_picking_id, odoo_picking_name, odoo_sale_name, odoo_product_id, cliente_raw, producto_raw, cantidad, unidad, entrada_predio, inicio_carga, fin_carga, salida_predio, notas, supervisor_raw, supervisor_id, sheets_fila, sheets_pendiente, sheets_pendiente_en"
    )
    .eq("id", id)
    .maybeSingle();
  return (data as OrdenDeCarga | null) ?? null;
}

/**
 * Qué remitos de Odoo ya tienen una orden de carga, para no ofrecerlos dos
 * veces.
 *
 * Se pregunta por los ids que Odoo devolvió y no por la tabla entera: son 25
 * ids, muy lejos del `.in()` que arma una URL que PostgREST rechaza con un 400
 * sin decir por qué (el límite real está por los cientos; de a 200 es seguro).
 */
export async function remitosYaUsados(
  supabase: SupabaseClient,
  pickingIds: number[]
): Promise<Set<number>> {
  const usados = new Set<number>();
  for (let i = 0; i < pickingIds.length; i += 200) {
    const lote = pickingIds.slice(i, i + 200);
    if (lote.length === 0) continue;
    const { data } = await supabase
      .from("despacho_ordenes_carga")
      .select("odoo_picking_id")
      .in("odoo_picking_id", lote);
    for (const f of data ?? []) {
      if (typeof f.odoo_picking_id === "number") usados.add(f.odoo_picking_id);
    }
  }
  return usados;
}
