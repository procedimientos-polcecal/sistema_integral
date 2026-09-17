/** Una fila de `taller_vial_cargas`: una carga de combustible con su lectura de horómetro/km. */
export interface CargaDB {
  id: string;
  equipo_id: string | null;
  equipo_raw: string;
  fecha: string;
  litros: number;
  lectura: number | null;
  observaciones: string | null;
  cargado_por: string | null;
  cargado_en: string;
  actualizado_por: string | null;
  actualizado_en: string | null;
}

/** Una fila de `taller_vial_estados_diarios`: el estado de un equipo en un día. */
export interface EstadoDiarioDB {
  id: string;
  equipo_id: string;
  fecha: string;
  estado: string;
}

/** Una fila de `taller_vial_services`: un service realizado a un equipo, a un horómetro y en un escalón. */
export interface ServiceDB {
  id: string;
  equipo_id: string;
  tier: number;
  fecha: string;
  horometro: number;
  observaciones: string | null;
  cargado_por: string | null;
  cargado_en: string;
}

/** Una fila de `taller_vial_reparaciones`: una intervención realizada a un equipo. */
export interface ReparacionDB {
  id: string;
  equipo_id: string;
  tipo: string;
  fecha: string;
  descripcion: string;
  horas: number | null;
  horometro: number | null;
  observaciones: string | null;
  cargado_por: string | null;
  cargado_en: string;
}

/**
 * Un repuesto del pañol reservado para un service o una reparación.
 * `estado: "reservado"` no descontó stock todavía; `"confirmado"` sí, y trae
 * `movimiento_id` puesto — ver la migración 20260917105422.
 */
export interface RepuestoAsignadoDB {
  id: string;
  service_id: string | null;
  reparacion_id: string | null;
  articulo_id: string;
  cantidad: number;
  estado: "reservado" | "confirmado";
  movimiento_id: string | null;
  cargado_por: string | null;
  cargado_en: string;
  confirmado_por: string | null;
  confirmado_en: string | null;
}

/** Un repuesto asignado, con los datos del artículo ya resueltos — lo que muestra la pantalla. */
export interface RepuestoAsignadoConArticulo extends RepuestoAsignadoDB {
  articulo_codigo: string;
  articulo_descripcion: string;
}
