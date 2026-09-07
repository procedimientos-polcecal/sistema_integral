/**
 * Los tipos del módulo Producción. Sin lógica: lo que decide algo vive en los
 * otros archivos de esta carpeta, para poder probarlo.
 */

export type Turno = "4_12" | "12_20";
export type Familia = "filler" | "0_2" | "cal" | "otros";
export type Envase = "bolsa" | "bolson";

export interface Producto {
  id: string;
  nombre: string;
  familia: Familia;
  envase: Envase;
  /** 25 la bolsa. El bolsón puede estar sin confirmar, y entonces es null. */
  kg_por_unidad: number | null;
  /** La columna en los resúmenes de la planilla. Null = no se exporta. */
  nombre_planilla: string | null;
  orden: number;
  activo: boolean;
}

export interface Parte {
  id: string;
  /** "YYYY-MM-DD" */
  fecha: string;
  turno: Turno;
  capataz_raw: string | null;
  capataz_id: string | null;
  observaciones: string | null;
  tareas_limpieza: string | null;
  recuento_bolsones: string | null;
  sheets_pendiente: string | null;
  sheets_pendiente_en: string | null;
  // Quién cargó el parte y quién lo corrigió después, con cuándo: transcribir
  // se equivoca, y a diferencia del kardex de Inventario acá no se versiona el
  // parte entero, así que esto es el único rastro de una corrección.
  cargado_por: string;
  cargado_en: string;
  actualizado_por: string | null;
  actualizado_en: string | null;
}

export interface Despacho {
  id: string;
  parte_id: string;
  orden: number;
  equipo_raw: string | null;
  cliente_raw: string | null;
  producto_id: string | null;
  producto_raw: string | null;
  kilos: number | null;
  bultos: number | null;
  envase_raw: string | null;
  pallets_cantidad: number | null;
  pallets_tipo: string | null;
  rotura_bolsa: number;
  rotura_bolson: number;
}

/**
 * Cantidad por producto. La clave es el id del producto.
 *
 * `produccion_deposito` (parte_id, producto_id, cantidad) no tiene una
 * interfaz propia porque nadie la lee ni la escribe fila por fila: el depósito
 * siempre se maneja acotado a un parte —de a un turno entero, nunca una fila
 * suelta—, así que la forma útil de acá para afuera es este mapa por
 * producto. Si algún día hace falta la fila individual, se agrega acá.
 */
export type PorProducto = Readonly<Record<string, number>>;
