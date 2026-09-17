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
