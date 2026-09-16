import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { saldosDelLibro, saldoCorrido, type Saldos } from "./movimientos";
import type {
  Carbonillero,
  CarbonReal,
  LineaSinReconocer,
  Movimiento,
  ProductoDeOdoo,
} from "./types";

/**
 * Traer lo que hace falta para mostrar el stock.
 *
 * **Todo con `traerTodo()`.** PostgREST corta en 1000 filas y no avisa: un
 * `.limit(3000)` devuelve 1000. El libro son mil movimientos por año y arranca
 * con veinte meses importados, así que ya nace del otro lado del corte. No
 * razonar "esta tabla es chica": el tablero de Compras parecía una cola acotada
 * y arrastra 1.900 filas.
 */

export async function traerCarbonilleros(supabase: SupabaseClient): Promise<Carbonillero[]> {
  return traerTodo<Carbonillero>((desde, hasta) =>
    supabase
      .from("calidad_carbonilleros")
      .select(
        "id, odoo_partner_id, empresa_id, proveedor_id, carbon, nombre_planilla, codigo_planilla, activo"
      )
      .order("nombre_planilla")
      .range(desde, hasta)
  );
}

export async function traerProductosDeOdoo(supabase: SupabaseClient): Promise<ProductoDeOdoo[]> {
  return traerTodo<ProductoDeOdoo>((desde, hasta) =>
    supabase
      .from("calidad_productos_odoo")
      .select("odoo_product_id, odoo_product_nombre, cuenta")
      .order("odoo_product_nombre")
      .range(desde, hasta)
  );
}

/**
 * Todos los movimientos, ordenados como se leen.
 *
 * Hace falta el libro entero para el saldo: un saldo parcial no es un saldo. Y
 * por eso mismo esta función no acepta filtro — el que filtra es quien muestra,
 * después de haber calculado.
 */
export async function traerMovimientos(supabase: SupabaseClient): Promise<Movimiento[]> {
  return traerTodo<Movimiento>((desde, hasta) =>
    supabase
      .from("calidad_movimientos")
      .select(
        "id, fecha, tipo, carbon, toneladas, motivo, carbonillero_id, proveedor_id, origen, odoo_purchase_line_id, odoo_purchase_name, despacho_recepcion_id, sheets_fila, sheets_pendiente, sheets_pendiente_en, cargado_por, cargado_en, actualizado_por, actualizado_en"
      )
      .order("fecha")
      .order("cargado_en")
      .range(desde, hasta)
  );
}

export async function traerBandeja(supabase: SupabaseClient): Promise<LineaSinReconocer[]> {
  return traerTodo<LineaSinReconocer>((desde, hasta) =>
    supabase
      .from("calidad_odoo_sin_reconocer")
      .select(
        "odoo_purchase_line_id, odoo_purchase_name, odoo_partner_id, odoo_partner_nombre, odoo_product_id, odoo_product_nombre, fecha, toneladas, motivo, visto_en"
      )
      .order("fecha", { ascending: false })
      .range(desde, hasta)
  );
}

export interface ElStock {
  saldos: Saldos;
  movimientos: Movimiento[];
  /** El del último movimiento cargado, para que la pantalla diga cuán viejo es lo que muestra. */
  ultimaFecha: string | null;
  /** El último consumo, por tipo: es el aviso que sirve. */
  ultimoConsumo: { vegetal: string | null; residual: string | null };
}

export async function traerElStock(supabase: SupabaseClient): Promise<ElStock> {
  const movimientos = await traerMovimientos(supabase);
  const consumos = movimientos.filter((m) => m.tipo === "consumo");

  const ultimoDe = (carbon: CarbonReal) =>
    consumos.filter((m) => m.carbon === carbon).at(-1)?.fecha ?? null;

  return {
    saldos: saldosDelLibro(movimientos),
    movimientos,
    ultimaFecha: movimientos.at(-1)?.fecha ?? null,
    ultimoConsumo: { vegetal: ultimoDe("vegetal"), residual: ultimoDe("residual") },
  };
}

/**
 * El saldo teórico de un tipo **hoy**, que es contra lo que se compara un conteo.
 *
 * Lee el libro entero a propósito. Es la misma pasada que hace la pantalla, y
 * un teórico calculado sobre una parte del libro sería un número que se parece
 * al bueno — que es exactamente lo que no queremos en el lugar donde alguien
 * decide mover el stock cientos de toneladas.
 */
export async function teoricoDe(
  supabase: SupabaseClient,
  carbon: CarbonReal
): Promise<number> {
  const movimientos = await traerMovimientos(supabase);
  return saldosDelLibro(movimientos)[carbon];
}

export { saldoCorrido };
