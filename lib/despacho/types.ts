/**
 * Los tipos de Despacho.
 *
 * El estado de una orden y sus dos tiempos **no están acá**: no son campos, se
 * despejan de los cuatro horarios (`orden.ts`). Es la misma decisión que
 * Producción tomó con la producción misma, y por el mismo motivo: un valor
 * derivado guardado se desincroniza y nada avisa.
 */

/** Los cuatro horarios del papel, en el orden en que ocurren. */
export interface HorariosDeOrden {
  entrada_predio: string | null;
  inicio_carga: string | null;
  fin_carga: string | null;
  salida_predio: string | null;
}

export type HorarioDeOrden = keyof HorariosDeOrden;

/**
 * Hasta dónde llegó el camión. Se despeja de los horarios, no se guarda.
 *
 * `esperando` es una orden dada de alta cuyo camión no entró al predio todavía.
 */
export type EstadoDeOrden = "esperando" | "en_predio" | "cargando" | "cargado" | "cerrada";

// `Clasificacion` y el catálogo de productos se fueron al núcleo cuando
// Producción y Despacho pasaron a compartirlo: viven en `lib/core/types.ts`
// (`Clasificacion`, `Producto`) y `lib/core/productos.ts`. `despacho_productos`
// no existe más.

/** Una fila de `despacho_ordenes_carga`. */
export interface OrdenDeCarga extends HorariosDeOrden {
  id: string;
  /** El Nº preimpreso del talonario. Único. */
  numero: string;
  fecha: string;
  /** Null en las filas del histórico importado: la planilla no dice la empresa. */
  empresa_id: string | null;

  /** Los cuatro nullables: Polysan deja remitos en draft y la orden se guarda igual. */
  odoo_picking_id: number | null;
  odoo_picking_name: string | null;
  odoo_sale_name: string | null;
  odoo_product_id: number | null;

  cliente_raw: string | null;
  producto_raw: string | null;
  cantidad: number | null;
  unidad: string | null;

  notas: string | null;
  supervisor_raw: string | null;
  supervisor_id: string | null;

  sheets_fila: number | null;
  sheets_pendiente: string | null;
  sheets_pendiente_en: string | null;
}

/** Un remito de salida de Odoo, como lo necesita la pantalla para elegirlo. */
export interface RemitoDeOdoo {
  picking_id: number;
  /** `0001-00077045` en Polcecal, `Polys/OUT/05776` en Polysan. */
  nombre: string;
  cliente: string;
  /** El `origin`: el pedido de venta del que salió (`S08526`). */
  pedido: string | null;
  odoo_company_id: number;
  estado: string;
  producto: string | null;
  odoo_product_id: number | null;
  cantidad: number | null;
  unidad: string | null;
}

/**
 * Una fila de `despacho_recepciones`: un camión de material que entró.
 *
 * El neto y el estado **no están acá** porque no se guardan: se despejan de los
 * pesos y de si ya tiene orden (ver `recepcion.ts`).
 */
export interface Recepcion {
  id: string;
  fecha: string;
  empresa_id: string | null;
  proveedor_id: string;
  odoo_product_id: number | null;
  odoo_product_nombre: string | null;
  /** En kilos, que es lo que dice la balanza. La tonelada es una división. */
  peso_bruto_kg: number | null;
  peso_tara_kg: number | null;
  lugar_descarga: string | null;
  notas: string | null;
  /** Los tres pasos de Odoo, guardados apenas ocurren. */
  odoo_purchase_order_id: number | null;
  odoo_purchase_name: string | null;
  odoo_picking_id: number | null;
  /** Lo que dijo Odoo, sin traducir. */
  odoo_error: string | null;
  odoo_error_en: string | null;
  sheets_fila: number | null;
  sheets_pendiente: string | null;
  sheets_pendiente_en: string | null;
  cargado_por: string | null;
  cargado_en: string;
  actualizado_por: string | null;
  actualizado_en: string | null;
}

/** Qué producto de Odoo y qué nombre de planilla le corresponde a un proveedor. */
export interface ProveedorDeRecepcion {
  proveedor_id: string;
  odoo_product_id: number;
  odoo_product_nombre: string;
  /** `Bruzzone`, no `BRUZZONE JUAN ALBERTO`: es como lo escribe el libro. */
  nombre_planilla: string;
  activo: boolean;
}
